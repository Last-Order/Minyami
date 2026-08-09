import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getAvailableOutputPath } from "../../utils/common";
import logger from "../../utils/log";
import FileConcentrator from "../file_concentrator";
import { DownloadTask, DownloaderConfig } from "../downloader";
import { createContainerOutputPath, MediaContainer } from "../media_container";
import { MuxInput, selectAvailableMuxer } from "../muxer";
import { MediaTrack } from "../source/stream_selection";
import { DownloadItem, DownloadTrackId, SourceTrack } from "../source/types";
import { TrackArtifact } from "./controller";
import { ChunkExecutor, ChunkResult } from "./chunk_executor";
import { normalizeDownloaderConfig, NormalizedDownloaderConfig } from "./config";
import { Aes128CbcHandler } from "./encryption/aes_128_cbc";
import { EncryptionHandlerRegistry } from "./encryption/registry";
import { DownloadHttpClient } from "./http_client";
import { mixedItemNamer } from "./item_naming";
import { KeyStore } from "./key_store";
import { ProgressTracker } from "./progress";

export interface ExecutedChunk extends ChunkResult {
    task: DownloadTask;
}

export interface RuntimeTrackSnapshot {
    readonly id: DownloadTrackId;
    readonly mediaTrack: MediaTrack;
    readonly sourcePath: string;
    readonly plannedOutputPath: string;
    readonly outputPaths: readonly string[];
}

interface RuntimeTrack {
    readonly metadata: SourceTrack;
    readonly tempPath: string;
    readonly plannedOutputPath: string;
    readonly concentrator?: FileConcentrator;
    outputPaths: string[];
}

export class DownloadRuntime {
    readonly config: NormalizedDownloaderConfig;
    readonly http: DownloadHttpClient;
    readonly keys = new KeyStore();
    readonly encryptionHandlers = new EncryptionHandlerRegistry([new Aes128CbcHandler()]);
    readonly progress = new ProgressTracker();
    readonly chunkExecutor: ChunkExecutor;

    tempPath: string;
    readonly outputBasePath: string;

    private readonly tracks = new Map<DownloadTrackId, RuntimeTrack>();
    private tracksConfigured = false;
    private sourceContainer?: MediaContainer;
    private muxedOutputPath?: string;

    constructor(config: DownloaderConfig = {}) {
        this.config = normalizeDownloaderConfig(config);
        this.tempPath = this.config.tempPath;
        this.outputBasePath = this.config.outputBasePath;
        this.http = new DownloadHttpClient(this.config);
        this.chunkExecutor = new ChunkExecutor(this.http, this.keys, this.encryptionHandlers);
    }

    async allocateWorkspace(): Promise<void> {
        this.validateTemporaryBasePath();
        this.tempPath = path.resolve(this.tempPath, `minyami_${Date.now()}_${randomBytes(4).toString("hex")}`);
        fs.mkdirSync(this.tempPath);
    }

    configureTracks(metadata: readonly SourceTrack[], container: MediaContainer): void {
        if (this.tracksConfigured) {
            throw new Error("Download tracks have already been configured.");
        }
        this.tracksConfigured = true;
        this.sourceContainer = container;
        this.progress.registerTracks(metadata.map((track) => track.id));

        for (const track of metadata) {
            const trackTempPath = path.resolve(this.tempPath, track.id);
            fs.mkdirSync(trackTempPath);
            const plannedOutputPath = getAvailableOutputPath(this.createTrackOutputPath(track.id, metadata.length));
            this.tracks.set(track.id, {
                metadata: track,
                tempPath: trackTempPath,
                plannedOutputPath,
                concentrator: this.config.noMerge
                    ? undefined
                    : new FileConcentrator({
                          outputPath: plannedOutputPath,
                          deleteAfterWritten: !this.config.keepTemporaryFiles,
                      }),
                outputPaths: [],
            });
        }
    }

    nameItem(item: DownloadItem, taskId: number, trackId: DownloadTrackId, trackIndex: number): string {
        const track = this.requireTrack(trackId);
        const filename = (track.metadata.itemNamer ?? mixedItemNamer)(item, { taskId, trackId, trackIndex });
        // Source naming may affect a basename, but the runtime owns track-directory isolation.
        if (
            !filename ||
            filename === "." ||
            filename === ".." ||
            path.isAbsolute(filename) ||
            filename.includes("/") ||
            filename.includes("\\")
        ) {
            throw new Error(`Invalid output filename for track ${trackId}: ${filename}`);
        }
        return filename;
    }

    async execute(task: DownloadTask): Promise<ExecutedChunk> {
        const track = this.requireTrack(task.trackId);
        const result = await this.chunkExecutor.execute(task, {
            tempPath: track.tempPath,
            itemTimeout: track.metadata.itemTimeout ?? 60000,
            keepEncryptedChunks: this.config.keepEncryptedChunks,
        });
        return { ...result, task };
    }

    recordTaskSuccess(task: DownloadTask): void {
        this.progress.recordSuccessful(task);
    }

    markOutputReady(task: DownloadTask, outputPath: string): void {
        const concentrator = this.requireTrack(task.trackId).concentrator;
        if (!concentrator) {
            return;
        }
        concentrator.markTaskReady({ filePath: outputPath, index: task.trackIndex });
    }

    recordTaskFailure(task: DownloadTask): "retry" | "drop" {
        task.retryCount = task.retryCount ? task.retryCount + 1 : 1;
        if (task.retryCount < this.config.retries) {
            return "retry";
        }
        this.requireTrack(task.trackId).concentrator?.markTaskDropped(task.trackIndex);
        this.progress.recordDropped(task);
        return "drop";
    }

    async finishOutput(expectedTaskCounts: ReadonlyMap<DownloadTrackId, number>): Promise<readonly TrackArtifact[]> {
        if (this.config.noMerge) {
            return [];
        }

        const errors: unknown[] = [];
        await Promise.all(
            [...this.tracks.values()].map(async (track) => {
                try {
                    const expectedTaskCount = expectedTaskCounts.get(track.metadata.id);
                    if (expectedTaskCount === undefined) {
                        throw new Error(`Missing expected task count for track ${track.metadata.id}.`);
                    }
                    await track.concentrator.waitAllFilesWritten(expectedTaskCount);
                    track.outputPaths = track.concentrator.getOutputFilePaths();
                } catch (error) {
                    errors.push(error);
                }
            })
        );
        if (errors.length > 0) {
            throw errors[0];
        }
        // Cross-track muxing starts only after every concentrator has closed its immutable inputs.
        const artifacts = this.getTrackArtifacts();
        await this.muxTrackArtifacts(artifacts);
        return this.getTrackArtifacts();
    }

    abortOutput(): void {
        for (const track of this.tracks.values()) {
            track.concentrator?.abort();
        }
    }

    getTrackSnapshots(): readonly RuntimeTrackSnapshot[] {
        return [...this.tracks.values()].map((track) => ({
            id: track.metadata.id,
            mediaTrack: track.metadata.mediaTrack,
            sourcePath: track.metadata.sourcePath,
            plannedOutputPath: track.plannedOutputPath,
            outputPaths: [...track.outputPaths],
        }));
    }

    getTrackArtifacts(): readonly TrackArtifact[] {
        return [...this.tracks.values()]
            .filter((track) => track.outputPaths.length > 0)
            .map((track) => ({
                trackId: track.metadata.id,
                mediaTrack: track.metadata.mediaTrack,
                sourcePath: track.metadata.sourcePath,
                outputPaths: [...track.outputPaths],
            }));
    }

    getOutputPaths(): string[] {
        if (this.muxedOutputPath) {
            return [this.muxedOutputPath];
        }
        return this.getTrackArtifacts().flatMap((artifact) => artifact.outputPaths);
    }

    cleanupEmptyWorkspace(): void {
        for (const track of this.tracks.values()) {
            if (fs.existsSync(track.tempPath) && fs.readdirSync(track.tempPath).length === 0) {
                fs.rmdirSync(track.tempPath);
            }
        }
        if (fs.existsSync(this.tempPath) && fs.readdirSync(this.tempPath).length === 0) {
            fs.rmdirSync(this.tempPath);
        }
    }

    private createTrackOutputPath(trackId: DownloadTrackId, trackCount: number): string {
        if (!this.sourceContainer) {
            throw new Error("Download source container has not been configured.");
        }
        return createContainerOutputPath(
            this.outputBasePath,
            this.sourceContainer,
            trackCount === 1 ? undefined : trackId
        );
    }

    private async muxTrackArtifacts(artifacts: readonly TrackArtifact[]): Promise<void> {
        const hasVideo = artifacts.some((artifact) => artifact.mediaTrack.type === "video");
        const hasAudio = artifacts.some((artifact) => artifact.mediaTrack.type === "audio");
        if (!hasVideo || !hasAudio) {
            return;
        }
        if (artifacts.some((artifact) => artifact.outputPaths.length !== 1)) {
            // Split runs do not carry enough timing information to pair cross-track gaps safely.
            logger.warning("Skip muxing because at least one track was split into multiple output files.");
            return;
        }

        const muxer = await selectAvailableMuxer(this.config.muxers);
        if (!muxer) {
            logger.warning("No available muxer was found. Keep the independently merged track files.");
            return;
        }

        const inputs: MuxInput[] = artifacts.map((artifact) => ({
            trackId: artifact.trackId,
            mediaTrack: artifact.mediaTrack,
            inputPath: artifact.outputPaths[0],
        }));
        const outputPath = getAvailableOutputPath(
            createContainerOutputPath(this.outputBasePath, muxer.outputContainer)
        );
        logger.info(`Muxing audio and video tracks with ${muxer.name}...`);
        try {
            await muxer.mux({ inputs, outputPath });
            if (!fs.existsSync(outputPath)) {
                throw new Error(`Muxer ${muxer.name} did not create the requested output file: ${outputPath}`);
            }
        } catch (error) {
            // A failed container must not be published; per-track artifacts remain recoverable.
            await fs.promises.unlink(outputPath).catch(() => undefined);
            throw error;
        }
        this.muxedOutputPath = outputPath;
        await this.deleteMuxInputs(inputs);
    }

    private async deleteMuxInputs(inputs: readonly MuxInput[]): Promise<void> {
        for (const input of inputs) {
            try {
                await fs.promises.unlink(input.inputPath);
                const track = this.requireTrack(input.trackId);
                // Snapshots expose only paths that still exist after successful mux cleanup.
                track.outputPaths = track.outputPaths.filter((outputPath) => outputPath !== input.inputPath);
            } catch {
                // Cleanup failure does not invalidate the already verified muxed container.
                logger.warning(`Failed to delete merged track file [${path.resolve(input.inputPath)}].`);
            }
        }
    }

    private requireTrack(trackId: DownloadTrackId): RuntimeTrack {
        const track = this.tracks.get(trackId);
        if (!track) {
            throw new Error(`Unknown download track: ${trackId}`);
        }
        return track;
    }

    private validateTemporaryBasePath(): void {
        if (!fs.existsSync(this.tempPath)) {
            throw new Error("Temporary path directory not exists.");
        }
    }
}
