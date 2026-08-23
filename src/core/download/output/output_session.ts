import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getAvailableOutputPath } from "../../../utils/common";
import logger from "../../../utils/log";
import { createContainerOutputPath, MediaContainer } from "../../media_container";
import { Muxer, MuxInput, selectAvailableMuxer } from "../../muxer";
import { MediaTrack } from "../../source/stream_selection";
import { DownloadTrackId, SourceTrack } from "../../source/types";
import { TrackArtifact } from "../controller";
import { DownloadTask } from "../execution/task";
import FileConcentrator from "./file_concentrator";

export interface OutputSessionConfig {
    readonly tempPath: string;
    readonly outputBasePath: string;
    readonly noMerge: boolean;
    readonly keepTemporaryFiles: boolean;
    readonly muxers: readonly Muxer[];
}

export interface OutputTrackSnapshot {
    readonly id: DownloadTrackId;
    readonly mediaTrack: MediaTrack;
    readonly sourcePath: string;
    readonly plannedOutputPath: string;
    readonly outputPaths: readonly string[];
}

interface OutputTrack {
    readonly metadata: SourceTrack;
    readonly tempPath: string;
    readonly plannedOutputPath: string;
    readonly writer?: FileConcentrator;
    outputPaths: string[];
}

/** Owns temporary storage and finalized artifacts, but no task or lifecycle accounting. */
export class OutputSession {
    tempPath: string;
    readonly outputBasePath: string;

    private readonly tracks = new Map<DownloadTrackId, OutputTrack>();
    private tracksConfigured = false;
    private sourceContainer?: MediaContainer;
    private muxedOutputPath?: string;

    constructor(readonly config: OutputSessionConfig) {
        this.tempPath = config.tempPath;
        this.outputBasePath = config.outputBasePath;
    }

    async allocateWorkspace(): Promise<void> {
        this.validateTemporaryBasePath();
        this.tempPath = path.resolve(this.tempPath, `minyami_${Date.now()}_${randomBytes(4).toString("hex")}`);
        fs.mkdirSync(this.tempPath);
    }

    configureTracks(metadata: readonly SourceTrack[], container: MediaContainer): void {
        if (this.tracksConfigured) {
            throw new Error("Download output tracks have already been configured.");
        }
        this.tracksConfigured = true;
        this.sourceContainer = container;

        for (const track of metadata) {
            const trackTempPath = path.resolve(this.tempPath, track.id);
            const plannedOutputPath = getAvailableOutputPath(this.createTrackOutputPath(track, metadata.length));
            this.tracks.set(track.id, {
                metadata: track,
                tempPath: trackTempPath,
                plannedOutputPath,
                writer: this.config.noMerge
                    ? undefined
                    : new FileConcentrator({
                          outputPath: plannedOutputPath,
                          deleteAfterWritten: !this.config.keepTemporaryFiles,
                      }),
                outputPaths: [],
            });
        }
        // Publish the complete output plan before filesystem creation so failure snapshots remain coherent.
        for (const track of this.tracks.values()) {
            fs.mkdirSync(track.tempPath);
        }
    }

    getTrackTempPath(trackId: DownloadTrackId): string {
        return this.requireTrack(trackId).tempPath;
    }

    markTaskReady(task: DownloadTask, outputPath: string): void {
        this.requireTrack(task.trackId).writer?.markTaskReady({
            filePath: outputPath,
            index: task.trackIndex,
            output: task.item.output,
        });
    }

    markTaskDropped(task: DownloadTask): void {
        this.requireTrack(task.trackId).writer?.markTaskDropped(task.trackIndex);
    }

    async finalize(expectedTaskCounts: ReadonlyMap<DownloadTrackId, number>): Promise<readonly TrackArtifact[]> {
        if (this.config.noMerge) {
            return [];
        }

        const errors: unknown[] = [];
        // Settle every track before reporting failure so no writer is left running behind a rejected session.
        await Promise.all(
            [...this.tracks.values()].map(async (track) => {
                try {
                    if (!track.writer) {
                        throw new Error(`Missing ordered output writer for track ${track.metadata.id}.`);
                    }
                    const expectedTaskCount = expectedTaskCounts.get(track.metadata.id);
                    if (expectedTaskCount === undefined) {
                        throw new Error(`Missing expected task count for track ${track.metadata.id}.`);
                    }
                    await track.writer.waitAllFilesWritten(expectedTaskCount);
                    track.outputPaths = track.writer.getOutputFilePaths();
                } catch (error) {
                    errors.push(error);
                }
            })
        );
        if (errors.length > 0) {
            throw errors[0];
        }

        // Cross-track muxing starts only after every ordered writer has closed its immutable inputs.
        const artifacts = this.getTrackArtifacts();
        await this.muxTrackArtifacts(artifacts);
        return this.getTrackArtifacts();
    }

    abort(): void {
        for (const track of this.tracks.values()) {
            track.writer?.abort();
        }
    }

    getTrackSnapshots(): readonly OutputTrackSnapshot[] {
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
        // Remove only provably empty directories; retained chunks and recovery data are never guessed away.
        for (const track of this.tracks.values()) {
            if (fs.existsSync(track.tempPath) && fs.readdirSync(track.tempPath).length === 0) {
                fs.rmdirSync(track.tempPath);
            }
        }
        if (fs.existsSync(this.tempPath) && fs.readdirSync(this.tempPath).length === 0) {
            fs.rmdirSync(this.tempPath);
        }
    }

    private createTrackOutputPath(track: SourceTrack, trackCount: number): string {
        if (!this.sourceContainer) {
            throw new Error("Download source container has not been configured.");
        }
        return createContainerOutputPath(
            this.outputBasePath,
            track.container ?? this.sourceContainer,
            trackCount === 1 ? undefined : track.id
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

    private requireTrack(trackId: DownloadTrackId): OutputTrack {
        const track = this.tracks.get(trackId);
        if (!track) {
            throw new Error(`Unknown output track: ${trackId}`);
        }
        return track;
    }

    private validateTemporaryBasePath(): void {
        if (!fs.existsSync(this.tempPath)) {
            throw new Error("Temporary path directory not exists.");
        }
    }
}
