import * as path from "path";
import logger from "../../../utils/log";
import { DownloadItem, DownloadSource, DownloadSourceContext } from "../../source/types";
import {
    ChunkDownloadedInfo,
    DownloadEvent,
    DownloadEventListener,
    DownloadStatus,
    SourceDownloadSnapshot,
} from "../controller";
import { ChunkExecutor, ChunkResult } from "../execution/chunk_executor";
import { DownloadTask } from "../execution/task";
import { TaskScheduler } from "../execution/task_scheduler";
import { normalizeDownloaderConfig, NormalizedDownloaderConfig } from "../config";
import { Aes128CbcHandler } from "../encryption/aes_128_cbc";
import { MpegTsSampleAesHandler } from "../encryption/mpeg_ts_sample_aes/handler";
import { EncryptionHandlerRegistry } from "../encryption/registry";
import { DownloadEventHub } from "./event_hub";
import { DownloadHttpClient } from "../infrastructure/http_client";
import { KeyStore } from "../infrastructure/key_store";
import { RetryingSourceHttpClient } from "../infrastructure/source_http_client";
import { DownloadManifest } from "./manifest";
import { OutputSession } from "../output/output_session";
import { DownloaderConfig } from "../types";

type SessionState =
    | { readonly kind: "idle" }
    | { readonly kind: "preparing" }
    | { readonly kind: "running" }
    | { readonly kind: "draining"; readonly reason: "source-ended" | "graceful-stop" | "hard-stop" }
    | { readonly kind: "finalizing"; readonly merging: boolean }
    | { readonly kind: "finished" }
    | { readonly kind: "failed"; readonly error: unknown }
    | { readonly kind: "aborted" };

type Cancellation = "none" | "graceful" | "hard";

/**
 * Owns the application lifecycle for one source. State transitions, accounting,
 * scheduling, and output commits all pass through this single session boundary.
 */
export class DownloadSession {
    private readonly config: NormalizedDownloaderConfig;
    private readonly http: DownloadHttpClient;
    private readonly keys = new KeyStore();
    private readonly encryptionHandlers = new EncryptionHandlerRegistry([
        new Aes128CbcHandler(),
        new MpegTsSampleAesHandler(),
    ]);
    private readonly executor: ChunkExecutor;
    private readonly manifest = new DownloadManifest();
    private readonly output: OutputSession;
    private readonly events = new DownloadEventHub();
    private readonly sourceContext: DownloadSourceContext;
    // Discovery and execution need independent signals: graceful stop must not cancel accepted tasks.
    private readonly sourceAbort = new AbortController();
    private readonly taskAbort = new AbortController();

    private state: SessionState = { kind: "idle" };
    private cancellation: Cancellation = "none";
    private scheduler?: TaskScheduler<DownloadTask, ChunkResult>;
    private schedulerCompletion?: Promise<void>;
    private schedulerFailure?: { readonly error: unknown };

    constructor(private readonly source: DownloadSource, config: DownloaderConfig = {}) {
        this.config = normalizeDownloaderConfig(config);
        this.http = new DownloadHttpClient(this.config);
        this.executor = new ChunkExecutor(this.http, this.keys, this.encryptionHandlers);
        this.output = new OutputSession(this.config);
        this.sourceContext = {
            // Sources receive policy-aware capabilities, never the downloader's scheduler or raw configuration.
            http: new RetryingSourceHttpClient(this.http, this.config.sourceRequestAttempts),
            keys: this.keys,
        };
    }

    async download(): Promise<void> {
        if (this.state.kind !== "idle") {
            throw new Error("This download controller has already been started.");
        }

        this.state = { kind: "preparing" };
        this.manifest.start();
        try {
            // Allocate first so every later failure has one known recovery location to report or clean.
            await this.output.allocateWorkspace();
            if (this.cancellation !== "none") {
                this.finishBeforeDiscovery();
                return;
            }

            let metadata;
            try {
                metadata = await this.source.prepare(this.sourceContext, this.sourceAbort.signal);
            } catch (error) {
                // A controller-requested cancellation is a terminal command, not a source failure.
                if (this.cancellation !== "none") {
                    this.finishBeforeDiscovery();
                    return;
                }
                throw error;
            }
            if ("cancelled" in metadata && metadata.cancelled) {
                this.finishBeforeDiscovery();
                return;
            }
            if (this.cancellation !== "none") {
                this.finishBeforeDiscovery();
                return;
            }

            // Manifest and output must agree on the immutable track set before observers see `parsed`.
            this.manifest.registerTracks(metadata.tracks);
            this.output.configureTracks(metadata.tracks, metadata.container);
            this.events.emit("parsed");
            if (this.cancellation !== "none") {
                this.finishBeforeDiscovery();
                return;
            }

            this.scheduler = this.createScheduler();
            // The pool remains open while the source is the sole producer of new tasks.
            this.schedulerCompletion = this.scheduler.start();
            // Discovery may still be awaiting its source when a worker reports a fatal commit error.
            void this.schedulerCompletion.catch(() => undefined);
            this.state = { kind: "running" };

            try {
                for await (const batch of this.source.discover(this.sourceContext, this.sourceAbort.signal)) {
                    if (this.getCancellation() === "hard") {
                        break;
                    }
                    // This is the only source-to-runtime conversion point: ids and filenames are assigned here.
                    const tasks = this.manifest.discover(batch, (item) => this.validateDownloadItem(item));
                    if (tasks.length > 0) {
                        this.scheduler.add([...tasks]);
                    }
                }
            } catch (error) {
                // Sources may express AbortSignal observation by returning or throwing.
                if (this.schedulerFailure) {
                    throw this.schedulerFailure.error;
                }
                if (this.getCancellation() === "none") {
                    throw error;
                }
            }

            const cancellation = this.getCancellation();
            const drainReason =
                cancellation === "hard" ? "hard-stop" : cancellation === "graceful" ? "graceful-stop" : "source-ended";
            this.state = { kind: "draining", reason: drainReason };
            if (cancellation === "hard") {
                this.scheduler.abort();
            } else {
                // No producer remains, so queued and retry work can drain to terminal outcomes.
                this.scheduler.close();
            }
            await this.schedulerCompletion;

            if (this.getCancellation() === "hard") {
                this.finishAborted();
                return;
            }
            await this.finalize();
        } catch (error) {
            this.scheduler?.abort();
            this.taskAbort.abort();
            this.output.abort();
            await this.schedulerCompletion?.catch(() => undefined);
            if (this.cancellation === "hard") {
                this.finishAborted();
                return;
            }
            this.fail(error);
            throw error;
        }
    }

    stop(): void {
        if (!this.acceptsGracefulStop()) {
            return;
        }
        if (this.cancellation === "none") {
            this.cancellation = "graceful";
            // Graceful stop ends production only; known tasks retain their execution signal.
            this.sourceAbort.abort();
        }
    }

    abort(): void {
        if (!this.acceptsHardAbort() || this.cancellation === "hard") {
            return;
        }
        const workspaceMayExist = this.state.kind !== "idle";
        this.cancellation = "hard";
        // Hard abort closes both sides of the pipeline and rejects any late output admission.
        this.sourceAbort.abort();
        this.taskAbort.abort();
        this.scheduler?.abort();
        this.output.abort();
        logger.info("Force stop requested. Waiting for active operations to settle.");
        if (workspaceMayExist && this.output.tempPath) {
            logger.info(`Your temporary files are located at [${path.resolve(this.output.tempPath)}]`);
        }
    }

    getSnapshot(): SourceDownloadSnapshot {
        const manifest = this.manifest.snapshot;
        const outputTracks = new Map(this.output.getTrackSnapshots().map((track) => [track.id, track]));
        // Join read-only views by track id; neither subsystem duplicates the other's mutable state.
        return {
            status: this.publicStatus(),
            sourcePath: this.source.sourcePath,
            tempPath: this.output.tempPath,
            outputBasePath: this.output.outputBasePath,
            outputPaths: this.output.getOutputPaths(),
            artifacts: this.output.getTrackArtifacts(),
            tracks: manifest.tracks.map((track) => {
                const output = outputTracks.get(track.metadata.id);
                if (!output) {
                    throw new Error(`Missing output state for track ${track.metadata.id}.`);
                }
                return {
                    id: track.metadata.id,
                    mediaTrack: track.metadata.mediaTrack,
                    sourcePath: track.metadata.sourcePath,
                    plannedOutputPath: output.plannedOutputPath,
                    outputPaths: output.outputPaths,
                    totalChunkCount: track.totalChunkCount,
                    completedChunkCount: track.completedChunkCount,
                    successfulChunkCount: track.successfulChunkCount,
                    droppedChunkCount: track.droppedChunkCount,
                    successfulDuration: track.successfulDuration,
                };
            }),
            startedAt: manifest.startedAt,
            completedChunkCount: manifest.completedChunkCount,
            successfulChunkCount: manifest.successfulChunkCount,
            droppedChunkCount: manifest.droppedChunkCount,
            successfulDuration: manifest.successfulDuration,
            runningTaskCount: this.scheduler?.runningCount ?? 0,
            pendingTaskCount: this.scheduler?.pendingCount ?? 0,
            totalChunkCount: manifest.totalChunkCount,
            isEnd: ["draining", "finalizing", "finished", "failed", "aborted"].includes(this.state.kind),
        };
    }

    on<TEvent extends DownloadEvent>(event: TEvent, listener: DownloadEventListener<TEvent>): void {
        this.events.on(event, listener);
    }

    once<TEvent extends DownloadEvent>(event: TEvent, listener: DownloadEventListener<TEvent>): void {
        this.events.once(event, listener);
    }

    off<TEvent extends DownloadEvent>(event: TEvent, listener: DownloadEventListener<TEvent>): void {
        this.events.off(event, listener);
    }

    private createScheduler(): TaskScheduler<DownloadTask, ChunkResult> {
        logger.info(`Start downloading with ${this.config.threads} thread(s).`);
        return new TaskScheduler<DownloadTask, ChunkResult>({
            concurrency: this.config.threads,
            execute: (task, attempt) =>
                this.executor.execute(task, {
                    tempPath: this.output.getTrackTempPath(task.trackId),
                    itemTimeout: this.manifest.getTrack(task.trackId).itemTimeout ?? 60000,
                    keepEncryptedChunks: this.config.keepEncryptedChunks,
                    attempt,
                    signal: this.taskAbort.signal,
                }),
            onSuccess: (task, result) => this.commitTaskSuccess(task, result),
            onError: (task, error, attempt) => this.commitTaskError(task, error, attempt),
            onFatal: (error) => {
                // A failed commit invalidates the session; wake discovery and cancel sibling attempts promptly.
                this.schedulerFailure = { error };
                this.sourceAbort.abort();
                this.taskAbort.abort();
            },
        });
    }

    private commitTaskSuccess(task: DownloadTask, result: ChunkResult): void {
        if (this.cancellation === "hard" || this.schedulerFailure) {
            return;
        }
        // Output admission precedes accounting so a rejected duplicate cannot inflate progress.
        this.output.markTaskReady(task, result.outputPath);
        this.manifest.recordSuccessful(task);
        const progress = this.manifest.snapshot;
        const chunkInfo: ChunkDownloadedInfo = {
            taskName: task.filename,
            trackId: task.trackId,
            completedChunkCount: progress.completedChunkCount,
            successfulChunkCount: progress.successfulChunkCount,
            droppedChunkCount: progress.droppedChunkCount,
            totalChunkCount: progress.totalChunkCount,
            successfulChunksPerSecond: this.manifest.successfulChunksPerSecond(),
            successfulDurationRatio: this.manifest.successfulDurationRatio(),
            ...(!this.source.continuous ? { completionEta: this.manifest.completionEta() } : {}),
        };
        this.logTaskSuccess(chunkInfo);
        this.events.emit("chunk-downloaded", chunkInfo);
    }

    private commitTaskError(task: DownloadTask, error: unknown, attempt: number): boolean {
        if (this.cancellation === "hard" || this.schedulerFailure) {
            return false;
        }
        this.events.emit("chunk-error", error, task.filename, task.trackId);
        if (attempt < this.config.taskAttempts) {
            logger.warning(`Processing ${task.filename} failed, retry later.`);
            return true;
        }
        // A terminal drop is still an ordered outcome and must unblock the output concentrator.
        this.output.markTaskDropped(task);
        this.manifest.recordDropped(task);
        logger.warning(`Processing ${task.filename} failed, max attempts exceeded, drop.`);
        return false;
    }

    private validateDownloadItem(item: DownloadItem): void {
        if (item.byteRange) {
            const { offset, length } = item.byteRange;
            if (
                !Number.isSafeInteger(offset) ||
                offset < 0 ||
                !Number.isSafeInteger(length) ||
                length <= 0 ||
                offset > Number.MAX_SAFE_INTEGER - (length - 1)
            ) {
                throw new Error("Download byte range must have a safe non-negative offset and positive length.");
            }
        }
        if (!item.encryption) {
            return;
        }
        const handler = this.encryptionHandlers.require(item.encryption.scheme);
        const key = this.keys.get(item.encryption.keyId);
        if (!key) {
            throw new Error(`Encryption key is not registered: ${item.encryption.keyId}`);
        }
        // Algorithm validation happens before a broken item can consume execution attempts.
        handler.validate(item.encryption, key);
    }

    private async finalize(): Promise<void> {
        // Finalization is non-cancellable: it publishes a stable result from the drained task set.
        this.state = { kind: "finalizing", merging: !this.config.noMerge };
        const progress = this.manifest.snapshot;
        const subject = this.source.continuous ? "discovered chunks" : "chunks";
        logger.info(
            `All ${subject} processed. Successful: ${progress.successfulChunkCount}; dropped: ${progress.droppedChunkCount}.`
        );

        if (this.config.noMerge) {
            // `downloaded` means task execution is complete; `finished` additionally means finalization returned.
            this.events.emit("downloaded");
            logger.info("Skip merging. Please merge video chunks manually.");
            logger.info(`Temporary files are located at ${this.output.tempPath}`);
            this.finish();
            return;
        }

        this.events.emit("downloaded");
        logger.info("Merging chunks...");
        // Expected counts close each ordered track writer and expose any missing terminal outcome.
        await this.output.finalize(this.manifest.expectedTaskCounts());
        if (!this.config.keepTemporaryFiles) {
            logger.info("End of merging.");
            logger.info("Starting cleaning temporary files.");
            try {
                this.output.cleanupEmptyWorkspace();
            } catch {
                logger.warning("Fail to delete temporary files, please delete them manually.");
            }
        }
        this.logOutputPaths(this.output.getOutputPaths());
        this.finish();
    }

    private finishBeforeDiscovery(): void {
        try {
            this.output.cleanupEmptyWorkspace();
        } catch {
            logger.warning(`Failed to delete empty temporary directory [${this.output.tempPath}].`);
        }
        if (this.cancellation === "hard") {
            this.finishAborted();
        } else {
            this.finish();
        }
    }

    private finish(): void {
        // Publish the terminal state before notifying observers so snapshots are stable inside callbacks.
        this.state = { kind: "finished" };
        this.events.emit("finished");
    }

    private finishAborted(): void {
        if (this.state.kind === "aborted") {
            return;
        }
        // Hard abort is terminal but deliberately distinct from a successfully finalized session.
        this.state = { kind: "aborted" };
        this.events.emit("finished");
    }

    private fail(error: unknown): void {
        this.state = { kind: "failed", error };
        logger.error("Aborted due to critical error.", error as Error);
        if (this.source.continuous && this.output.tempPath) {
            logger.info(`Your temporary files are located at [${path.resolve(this.output.tempPath)}]`);
        }
        this.events.emit("critical-error", error);
    }

    private acceptsGracefulStop(): boolean {
        return ["idle", "preparing", "running"].includes(this.state.kind);
    }

    private acceptsHardAbort(): boolean {
        // A draining session may still have queued or active work that hard abort is allowed to discard.
        return ["idle", "preparing", "running", "draining"].includes(this.state.kind);
    }

    private getCancellation(): Cancellation {
        // Cancellation may change while an awaited source or task operation is in flight.
        return this.cancellation;
    }

    private publicStatus(): DownloadStatus {
        if (this.cancellation !== "none" && ["idle", "preparing", "running", "draining"].includes(this.state.kind)) {
            return "stopping";
        }
        switch (this.state.kind) {
            case "idle":
                return "idle";
            case "preparing":
                return "preparing";
            case "running":
            case "draining":
                return "downloading";
            case "finalizing":
                return this.state.merging ? "merging" : "downloading";
            case "failed":
                return "failed";
            case "aborted":
                return "aborted";
            case "finished":
                return "finished";
        }
    }

    private logTaskSuccess(info: ChunkDownloadedInfo): void {
        if (this.source.continuous) {
            logger.info(
                `Processing ${info.taskName} finished. (Completed: ${info.completedChunkCount} / ${info.totalChunkCount} discovered | Successful: ${info.successfulChunkCount} | Dropped: ${info.droppedChunkCount} | Avg successful speed: ${info.successfulChunksPerSecond} chunks/s or ${info.successfulDurationRatio}x)`
            );
            return;
        }
        const percentage =
            info.totalChunkCount === 0
                ? "100.00"
                : ((info.completedChunkCount / info.totalChunkCount) * 100).toFixed(2);
        logger.info(
            `Processing ${info.taskName} finished. (Completed: ${info.completedChunkCount} / ${info.totalChunkCount} or ${percentage}% | Successful: ${info.successfulChunkCount} | Dropped: ${info.droppedChunkCount} | Avg successful speed: ${info.successfulChunksPerSecond} chunks/s or ${info.successfulDurationRatio}x | Completion ETA: ${info.completionEta})`
        );
    }

    private logOutputPaths(outputPaths: readonly string[]): void {
        if (outputPaths.length === 0) {
            logger.warning("All tasks finished, but no output file was created.");
        } else if (outputPaths.length === 1) {
            logger.info(`All finished. Please checkout your files at [${path.resolve(outputPaths[0])}]`);
        } else {
            logger.info(
                `All finished. Please checkout your files at ${outputPaths
                    .map((outputPath) => `[${path.resolve(outputPath)}]`)
                    .join(", ")}.`
            );
        }
    }
}
