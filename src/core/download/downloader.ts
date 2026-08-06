import { EventEmitter } from "events";
import * as path from "path";
import logger from "../../utils/log";
import { deleteEmptyDirectory } from "../../utils/system";
import { DownloadTask, DownloaderConfig } from "../downloader";
import { TaskStatus } from "../file_concentrator";
import { DownloadItem, DownloadSource, DownloadSourceContext, SourceBatch } from "../source/types";
import {
    ChunkDownloadedInfo,
    DownloadEvent,
    DownloadEventListener,
    DownloadSnapshot,
    DownloadStatus,
} from "./controller";
import { DownloadRuntime, ExecutedChunk } from "./runtime";
import { TaskScheduler } from "./task_scheduler";

interface DownloaderState {
    status: DownloadStatus;
    totalChunkCount: number;
    nextTaskId: number;
    sourceEnded: boolean;
    isDownloaded: boolean;
    isStarted: boolean;
    hardStopped: boolean;
    scheduler?: TaskScheduler<DownloadTask, ExecutedChunk>;
    schedulerCompletion?: Promise<void>;
    verboseTimer?: NodeJS.Timeout;
    sigintHandler?: () => void;
    sigintCount: number;
}

interface DownloaderContext {
    readonly source: DownloadSource;
    readonly runtime: DownloadRuntime;
    readonly sourceContext: DownloadSourceContext;
    readonly events: EventEmitter;
    readonly state: DownloaderState;
    readonly abortController: AbortController;
}

export interface SourceDownloadSnapshot extends DownloadSnapshot {
    totalChunkCount: number;
    isEnd: boolean;
}

export interface DownloadController {
    download(): Promise<void>;
    stop(): void;
    getSnapshot(): SourceDownloadSnapshot;
    on(event: DownloadEvent, listener: DownloadEventListener): DownloadController;
    once(event: DownloadEvent, listener: DownloadEventListener): DownloadController;
    off(event: DownloadEvent, listener: DownloadEventListener): DownloadController;
}

/**
 * Shared execution lifecycle for finite and continuous sources. Protocol logic
 * belongs in the source; this controller owns task/runtime state and output.
 */
export function createDownloader(source: DownloadSource, config: DownloaderConfig = {}): DownloadController {
    const runtime = new DownloadRuntime(config);
    runtime.sourcePath = source.sourcePath;
    const context: DownloaderContext = {
        source,
        runtime,
        sourceContext: {
            http: runtime.http,
            keys: runtime.keys,
            retries: runtime.config.retries,
            explicitKey: runtime.config.key,
        },
        events: new EventEmitter(),
        state: {
            status: "idle",
            totalChunkCount: 0,
            nextTaskId: 0,
            sourceEnded: false,
            isDownloaded: false,
            isStarted: false,
            hardStopped: false,
            sigintCount: 0,
        },
        abortController: new AbortController(),
    };
    const controller: DownloadController = {
        download: () => runDownloader(context),
        stop: () => stopDownloader(context),
        getSnapshot: () => getDownloadSnapshot(context),
        on(event, listener) {
            context.events.on(event, listener);
            return controller;
        },
        once(event, listener) {
            context.events.once(event, listener);
            return controller;
        },
        off(event, listener) {
            context.events.off(event, listener);
            return controller;
        },
    };
    return controller;
}

async function runDownloader(context: DownloaderContext): Promise<void> {
    const { runtime, source, sourceContext, state, events, abortController } = context;
    if (state.isStarted) {
        throw new Error("This download controller has already been started.");
    }
    state.isStarted = true;
    state.status = "preparing";
    runtime.progress.start();
    try {
        await runtime.allocateWorkspace();
        installSigintHandler(context);
        const metadata = await source.prepare(sourceContext, abortController.signal);
        runtime.sourcePath = metadata.sourcePath;
        if (metadata.itemNamer) {
            runtime.setItemNamer(metadata.itemNamer);
        }
        if (metadata.itemTimeout) {
            runtime.itemTimeout = metadata.itemTimeout;
        }
        events.emit("parsed");

        state.scheduler = createScheduler(context);
        // Start an open scheduler before discovery: sources are allowed to yield batches over time.
        state.schedulerCompletion = state.scheduler.start();
        startVerboseLogging(context);
        state.status = "downloading";

        for await (const batch of source.discover(sourceContext, abortController.signal)) {
            if (state.hardStopped) {
                break;
            }
            addSourceBatch(context, batch);
        }

        state.sourceEnded = true;
        // No producer remains after iterator exhaustion, so workers can now drain and exit.
        state.scheduler.close();
        await state.schedulerCompletion;
        await finishDownload(context);
    } catch (error) {
        state.scheduler?.abort();
        await state.schedulerCompletion?.catch(() => undefined);
        if (state.hardStopped) {
            return;
        }
        await failDownload(context, error);
        throw error;
    } finally {
        removeSigintHandler(state);
    }
}

function createScheduler(context: DownloaderContext): TaskScheduler<DownloadTask, ExecutedChunk> {
    const { runtime } = context;
    logger.info(`Start downloading with ${runtime.config.threads} thread(s).`);
    return new TaskScheduler<DownloadTask, ExecutedChunk>({
        concurrency: runtime.config.threads,
        execute: (task) => runtime.execute(task),
        onSuccess: (task, result) => onTaskSuccess(context, task, result),
        onError: (task, error) => onTaskError(context, task, error),
    });
}

function addSourceBatch(context: DownloaderContext, batch: SourceBatch): void {
    const { runtime, state } = context;
    // Runtime fields are assigned here so sources remain reusable and independent from retry/output policy.
    const tasks = batch.items.map((item): DownloadTask => {
        validateDownloadItem(context, item);
        // Discovery order is also merge order; ids must stay monotonic across every yielded batch.
        const id = state.nextTaskId++;
        return {
            id,
            item,
            filename: runtime.nameItem(item, id),
            retryCount: 0,
        };
    });
    for (const task of tasks) {
        runtime.taskStatusRecord[task.id] = TaskStatus.PENDING;
    }
    // Finite sources may publish their final total; otherwise the total means "discovered so far".
    state.totalChunkCount = batch.totalItemCount ?? state.nextTaskId;
    if (tasks.length > 0) {
        state.scheduler.add(tasks);
    }
}

function validateDownloadItem(context: DownloaderContext, item: DownloadItem): void {
    if (!item.encryption) {
        return;
    }
    // Reject a broken source contract before downloading the same unusable item on every retry.
    if (item.encryption.scheme !== "aes-128-cbc") {
        throw new Error(`Unsupported encryption scheme: ${item.encryption.scheme}`);
    }
    if (!item.encryption.iv) {
        throw new Error(`Missing encryption IV for ${item.url}`);
    }
    if (!context.runtime.keys.has(item.encryption.keyId)) {
        throw new Error(`Encryption key is not registered: ${item.encryption.keyId}`);
    }
}

async function onTaskSuccess(context: DownloaderContext, task: DownloadTask, result: ExecutedChunk): Promise<void> {
    const { runtime, source, state, events } = context;
    runtime.recordTaskSuccess(task);
    runtime.markOutputReady(task, result.outputPath);
    const progress = runtime.progress;
    const chunkInfo: ChunkDownloadedInfo = {
        taskName: task.filename,
        completedChunkCount: progress.completedChunkCount,
        successfulChunkCount: progress.successfulChunkCount,
        droppedChunkCount: progress.droppedChunkCount,
        totalChunkCount: state.totalChunkCount,
        successfulChunksPerSecond: progress.successfulChunksPerSecond(),
        successfulDurationRatio: progress.successfulDurationRatio(),
        ...(!source.continuous ? { completionEta: progress.completionEta(state.totalChunkCount) } : {}),
    };
    if (source.continuous) {
        logger.info(
            `Processing ${chunkInfo.taskName} finished. (Completed: ${chunkInfo.completedChunkCount} / ${chunkInfo.totalChunkCount} discovered | Successful: ${chunkInfo.successfulChunkCount} | Dropped: ${chunkInfo.droppedChunkCount} | Avg successful speed: ${chunkInfo.successfulChunksPerSecond} chunks/s or ${chunkInfo.successfulDurationRatio}x)`
        );
    } else {
        const percentage =
            chunkInfo.totalChunkCount === 0
                ? "100.00"
                : ((chunkInfo.completedChunkCount / chunkInfo.totalChunkCount) * 100).toFixed(2);
        logger.info(
            `Processing ${chunkInfo.taskName} finished. (Completed: ${chunkInfo.completedChunkCount} / ${chunkInfo.totalChunkCount} or ${percentage}% | Successful: ${chunkInfo.successfulChunkCount} | Dropped: ${chunkInfo.droppedChunkCount} | Avg successful speed: ${chunkInfo.successfulChunksPerSecond} chunks/s or ${chunkInfo.successfulDurationRatio}x | Completion ETA: ${chunkInfo.completionEta})`
        );
    }
    events.emit("chunk-downloaded", chunkInfo);
}

function onTaskError(context: DownloaderContext, task: DownloadTask, error: unknown): boolean {
    const { runtime, events } = context;
    events.emit("chunk-error", error, task.filename);
    if (runtime.recordTaskFailure(task) === "drop") {
        logger.warning(`Processing ${task.filename} failed, max retries exceed, drop.`);
        return false;
    }
    logger.warning(`Processing ${task.filename} failed, retry later.`);
    return true;
}

async function finishDownload(context: DownloaderContext): Promise<void> {
    const { runtime, state, events } = context;
    if (state.isDownloaded) {
        return;
    }
    state.isDownloaded = true;
    clearVerboseTimer(state);
    const subject = context.source.continuous ? "discovered chunks" : "chunks";
    logger.info(
        `All ${subject} processed. Successful: ${runtime.progress.successfulChunkCount}; dropped: ${runtime.progress.droppedChunkCount}.`
    );
    events.emit("downloaded");

    if (runtime.config.noMerge) {
        logger.info("Skip merging. Please merge video chunks manually.");
        logger.info(`Temporary files are located at ${runtime.tempPath}`);
        state.status = "finished";
        events.emit("finished");
        return;
    }

    state.status = "merging";
    logger.info("Merging chunks...");
    const outputPaths = await runtime.finishOutput();
    if (!runtime.config.keepTemporaryFiles) {
        logger.info("End of merging.");
        logger.info("Starting cleaning temporary files.");
        try {
            await deleteEmptyDirectory(runtime.tempPath);
        } catch {
            logger.warning(
                'Fail to delete temporary files, please delete manually or execute "minyami --clean" later.'
            );
        }
    }
    logOutputPaths(outputPaths);
    state.status = "finished";
    events.emit("finished");
}

function stopDownloader(context: DownloaderContext): void {
    const { state, abortController } = context;
    if (state.status === "finished" || state.status === "failed") {
        return;
    }
    state.status = "stopping";
    state.sourceEnded = true;
    // Graceful stop only ends production. Queued and running tasks are drained before output is finalized.
    abortController.abort();
}

function hardStopDownloader(context: DownloaderContext): void {
    const { runtime, state, events, abortController } = context;
    logger.info("Force stopped.");
    if (runtime.tempPath) {
        logger.info(`Your temporary files are located at [${path.resolve(runtime.tempPath)}]`);
    }
    state.hardStopped = true;
    state.sourceEnded = true;
    abortController.abort();
    // The second SIGINT is explicitly destructive to queued work and therefore bypasses merge/finalization.
    state.scheduler?.abort();
    if (!state.isDownloaded) {
        state.isDownloaded = true;
        state.status = "finished";
        clearVerboseTimer(state);
        events.emit("finished");
    }
}

function getDownloadSnapshot(context: DownloaderContext): SourceDownloadSnapshot {
    const { runtime, state } = context;
    return {
        status: state.status,
        sourcePath: runtime.sourcePath,
        tempPath: runtime.tempPath,
        outputPath: runtime.outputPath,
        startedAt: runtime.progress.startedAt,
        completedChunkCount: runtime.progress.completedChunkCount,
        successfulChunkCount: runtime.progress.successfulChunkCount,
        droppedChunkCount: runtime.progress.droppedChunkCount,
        successfulDuration: runtime.progress.successfulDuration,
        runningTaskCount: state.scheduler?.runningCount || 0,
        // Discovery only starts after scheduler creation, so no hidden pending tasks exist before it.
        pendingTaskCount: state.scheduler?.pendingCount ?? 0,
        totalChunkCount: state.totalChunkCount,
        isEnd: state.sourceEnded,
    };
}

function startVerboseLogging(context: DownloaderContext): void {
    const { runtime, state } = context;
    if (!runtime.config.verbose) {
        return;
    }
    state.verboseTimer = setInterval(() => {
        logger.debug(
            `Waiting tasks: ${state.scheduler.pendingCount}, completed chunks: ${runtime.progress.completedChunkCount}, successful chunks: ${runtime.progress.successfulChunkCount}, dropped chunks: ${runtime.progress.droppedChunkCount}, total discovered chunks: ${state.totalChunkCount}`
        );
    }, 3000);
}

function installSigintHandler(context: DownloaderContext): void {
    const { runtime, source, state } = context;
    if (!runtime.config.cliMode || !source.continuous || state.sigintHandler) {
        return;
    }
    state.sigintHandler = () => {
        state.sigintCount++;
        if (state.sigintCount === 1) {
            logger.info("Ctrl+C pressed, waiting for tasks finished.");
            stopDownloader(context);
            return;
        }
        hardStopDownloader(context);
    };
    process.on("SIGINT", state.sigintHandler);
}

async function failDownload(context: DownloaderContext, error: unknown): Promise<void> {
    const { runtime, state, events } = context;
    clearVerboseTimer(state);
    state.status = "failed";
    logger.error("Aborted due to critical error.", error as Error);
    if (context.source.continuous && runtime.tempPath) {
        logger.info(`Your temporary files are located at [${path.resolve(runtime.tempPath)}]`);
    }
    events.emit("critical-error", error);
}

function clearVerboseTimer(state: DownloaderState): void {
    if (state.verboseTimer) {
        clearInterval(state.verboseTimer);
        state.verboseTimer = undefined;
    }
}

function removeSigintHandler(state: DownloaderState): void {
    if (state.sigintHandler) {
        process.off("SIGINT", state.sigintHandler);
        state.sigintHandler = undefined;
    }
}

function logOutputPaths(outputPaths: string[]): void {
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
