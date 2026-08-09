import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getAvailableOutputPath } from "../../utils/common";
import FileConcentrator from "../file_concentrator";
import { DownloadTask, DownloaderConfig } from "../downloader";
import { DownloadItem, DownloadTrackId, SourceTrack } from "../source/types";
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

    constructor(config: DownloaderConfig = {}) {
        this.config = normalizeDownloaderConfig(config);
        this.tempPath = this.config.tempPath;
        this.outputBasePath = this.config.outputPath;
        this.http = new DownloadHttpClient(this.config);
        this.chunkExecutor = new ChunkExecutor(this.http, this.keys, this.encryptionHandlers);
    }

    async allocateWorkspace(): Promise<void> {
        this.validateTemporaryBasePath();
        this.tempPath = path.resolve(this.tempPath, `minyami_${Date.now()}_${randomBytes(4).toString("hex")}`);
        fs.mkdirSync(this.tempPath);
    }

    configureTracks(metadata: readonly SourceTrack[]): void {
        if (this.tracksConfigured) {
            throw new Error("Download tracks have already been configured.");
        }
        this.tracksConfigured = true;
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

    async finishOutput(expectedTaskCounts: ReadonlyMap<DownloadTrackId, number>): Promise<string[]> {
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
        return this.getOutputPaths();
    }

    abortOutput(): void {
        for (const track of this.tracks.values()) {
            track.concentrator?.abort();
        }
    }

    getTrackSnapshots(): readonly RuntimeTrackSnapshot[] {
        return [...this.tracks.values()].map((track) => ({
            id: track.metadata.id,
            sourcePath: track.metadata.sourcePath,
            plannedOutputPath: track.plannedOutputPath,
            outputPaths: [...track.outputPaths],
        }));
    }

    getOutputPaths(): string[] {
        return [...this.tracks.values()].flatMap((track) => track.outputPaths);
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
        if (trackCount === 1) {
            return this.outputBasePath;
        }
        const parsed = path.parse(this.outputBasePath);
        return path.join(parsed.dir, `${parsed.name}.${trackId}${parsed.ext}`);
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
