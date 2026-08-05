import { EventEmitter } from "events";
import * as path from "path";
import logger from "../utils/log";
import { deleteEmptyDirectory } from "../utils/system";
import { timeStringToSeconds } from "../utils/time";
import { TaskStatus } from "./file_concentrator";
import { ArchiveDownloaderConfig, DownloadTask } from "./downloader";
import { createArchiveTasks, sliceArchiveTasks } from "./download/archive_tasks";
import { DownloadEvent, DownloadEventListener, DownloadSnapshot, DownloadStatus } from "./download/controller";
import { DownloadRuntime, ExecutedChunk } from "./download/runtime";
import { TaskScheduler } from "./download/task_scheduler";

interface ArchiveState {
    status: DownloadStatus;
    downloadTasks: DownloadTask[];
    totalChunkCount: number;
    sliceStart?: number;
    sliceEnd?: number;
    isDownloaded: boolean;
    isStarted: boolean;
    scheduler?: TaskScheduler<DownloadTask, ExecutedChunk>;
    verboseTimer?: NodeJS.Timeout;
}

interface ArchiveContext {
    readonly runtime: DownloadRuntime;
    readonly events: EventEmitter;
    readonly state: ArchiveState;
}

export interface ArchiveDownloadSnapshot extends DownloadSnapshot {
    totalChunkCount: number;
}

export interface ArchiveDownloadController {
    download(): Promise<void>;
    getSnapshot(): ArchiveDownloadSnapshot;
    on(event: DownloadEvent, listener: DownloadEventListener): ArchiveDownloadController;
    once(event: DownloadEvent, listener: DownloadEventListener): ArchiveDownloadController;
    off(event: DownloadEvent, listener: DownloadEventListener): ArchiveDownloadController;
}

export function createArchiveDownloader(
    m3u8Path: string,
    config: ArchiveDownloaderConfig = {}
): ArchiveDownloadController {
    const state: ArchiveState = {
        status: "idle",
        downloadTasks: [],
        totalChunkCount: 0,
        isDownloaded: false,
        isStarted: false,
    };
    if (config.slice) {
        const [start, end] = config.slice.split("-");
        state.sliceStart = timeStringToSeconds(start);
        state.sliceEnd = timeStringToSeconds(end);
    }

    const context: ArchiveContext = {
        runtime: new DownloadRuntime(m3u8Path, config),
        events: new EventEmitter(),
        state,
    };
    const controller: ArchiveDownloadController = {
        download: () => downloadArchive(context),
        getSnapshot: () => getArchiveSnapshot(context),
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

async function downloadArchive(context: ArchiveContext): Promise<void> {
    const { runtime, state } = context;
    if (state.isStarted) {
        throw new Error("This archive download controller has already been started.");
    }
    state.isStarted = true;
    state.status = "preparing";
    runtime.progress.start();
    try {
        await runtime.allocateWorkspace();
        await runtime.loadInitialPlaylist();
        await prepareNewArchiveDownload(context);
        state.status = "downloading";
        await runArchiveScheduler(context);
    } catch (error) {
        await failArchive(context, error);
        throw error;
    }
}

async function prepareNewArchiveDownload(context: ArchiveContext): Promise<void> {
    const { runtime, state } = context;
    await prepareArchiveSiteAndKeys(context);
    state.downloadTasks = createArchiveTasks(runtime.playlist, (chunk, id) => runtime.nameChunk(chunk, id));
    state.downloadTasks = sliceArchiveTasks(state.downloadTasks, state.sliceStart, state.sliceEnd);
    state.totalChunkCount = state.downloadTasks.length;
    initializeArchiveTaskStatuses(context, state.downloadTasks);
}

async function prepareArchiveSiteAndKeys(context: ArchiveContext) {
    const { runtime, events } = context;
    await runtime.prepareSite("archive");
    events.emit("parsed");
    await runtime.checkKeys();
}

function initializeArchiveTaskStatuses(context: ArchiveContext, tasks: DownloadTask[]): void {
    const { runtime } = context;
    const maxId = tasks.reduce((highest, task) => Math.max(highest, task.id), -1);
    for (let id = 0; id <= maxId; id++) {
        runtime.taskStatusRecord[id] = TaskStatus.DROPPED;
    }
    for (const task of tasks) {
        runtime.taskStatusRecord[task.id] = TaskStatus.PENDING;
    }
}

async function runArchiveScheduler(context: ArchiveContext): Promise<void> {
    const { runtime, state } = context;
    logger.info(`Start downloading with ${runtime.config.threads} thread(s).`);
    state.scheduler = new TaskScheduler<DownloadTask, ExecutedChunk>({
        concurrency: runtime.config.threads,
        execute: (task) => runtime.execute(task),
        onSuccess: (task, result) => onArchiveTaskSuccess(context, task, result),
        onError: (task, error) => onArchiveTaskError(context, task, error),
    });
    state.scheduler.add(state.downloadTasks);

    if (runtime.config.verbose) {
        state.verboseTimer = setInterval(() => {
            logger.debug(
                `Waiting tasks: ${state.scheduler.pendingCount}, finished chunks: ${runtime.progress.finishedChunkCount}, total chunks: ${state.totalChunkCount}`
            );
        }, 3000);
    }

    const completion = state.scheduler.start();
    state.scheduler.close();
    await completion;
    clearArchiveVerboseTimer(state);
    await finishArchiveDownload(context);
}

async function onArchiveTaskSuccess(context: ArchiveContext, task: DownloadTask, result: ExecutedChunk): Promise<void> {
    const { runtime, state, events } = context;
    runtime.recordFinished(task);
    runtime.markOutputReady(task, result.outputPath);
    const progress = runtime.progress;
    const chunkInfo = {
        taskname: task.filename,
        finishedChunksCount: progress.finishedChunkCount,
        totalChunksCount: state.totalChunkCount,
        chunkSpeed: progress.speedByChunk(),
        ratioSpeed: progress.speedByRatio(),
        eta: progress.eta(state.totalChunkCount),
    };
    logger.info(
        `Processing ${chunkInfo.taskname} finished. (${chunkInfo.finishedChunksCount} / ${
            chunkInfo.totalChunksCount
        } or ${((chunkInfo.finishedChunksCount / chunkInfo.totalChunksCount) * 100).toFixed(2)}% | Avg Speed: ${
            chunkInfo.chunkSpeed
        } chunks/s or ${chunkInfo.ratioSpeed}x | ETA: ${chunkInfo.eta})`
    );
    events.emit("chunk-downloaded", chunkInfo);
}

function onArchiveTaskError(context: ArchiveContext, task: DownloadTask, error: unknown): boolean {
    const { runtime, events } = context;
    events.emit("chunk-error", error, task.filename);
    if (runtime.recordTaskFailure(task) === "drop") {
        logger.warning(`Processing ${task.filename} failed, max retries exceed, drop.`);
        return false;
    }
    logger.warning(`Processing ${task.filename} failed, retry later.`);
    return true;
}

async function finishArchiveDownload(context: ArchiveContext): Promise<void> {
    const { runtime, state, events } = context;
    if (state.isDownloaded) {
        return;
    }
    state.isDownloaded = true;
    logger.info("All chunks downloaded. Start merging chunks.");
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
    logArchiveOutputPaths(outputPaths);
    state.status = "finished";
    events.emit("finished");
}

function getArchiveSnapshot(context: ArchiveContext): ArchiveDownloadSnapshot {
    const { runtime, state } = context;
    return {
        status: state.status,
        sourcePath: runtime.sourcePath,
        tempPath: runtime.tempPath,
        outputPath: runtime.outputPath,
        startedAt: runtime.progress.startedAt,
        finishedChunkCount: runtime.progress.finishedChunkCount,
        finishedChunkLength: runtime.progress.finishedChunkLength,
        runningTaskCount: state.scheduler?.runningCount || 0,
        pendingTaskCount: state.scheduler?.pendingCount ?? state.downloadTasks.length,
        totalChunkCount: state.totalChunkCount,
    };
}

function logArchiveOutputPaths(outputPaths: string[]): void {
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

async function failArchive(context: ArchiveContext, error: unknown): Promise<void> {
    const { runtime, state, events } = context;
    clearArchiveVerboseTimer(state);
    state.status = "failed";
    logger.error("Aborted due to critical error.", error as Error);
    events.emit("critical-error", error);
}

function clearArchiveVerboseTimer(state: ArchiveState): void {
    if (state.verboseTimer) {
        clearInterval(state.verboseTimer);
        state.verboseTimer = undefined;
    }
}
