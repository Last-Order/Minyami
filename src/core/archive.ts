import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import logger from "../utils/log";
import { deleteEmptyDirectory } from "../utils/system";
import { deleteTask, getTask, saveTask } from "../utils/task";
import { timeStringToSeconds } from "../utils/time";
import { TaskStatus } from "./file_concentrator";
import { ArchiveDownloaderConfig, DownloadTask } from "./downloader";
import { cloneTasks, createArchiveTasks, sliceArchiveTasks } from "./download/archive_tasks";
import { DownloadEvent, DownloadEventListener, DownloadSnapshot, DownloadStatus } from "./download/controller";
import { DownloadRuntime, ExecutedChunk } from "./download/runtime";
import { TaskScheduler } from "./download/task_scheduler";

interface ArchiveState {
    status: DownloadStatus;
    downloadTasks: DownloadTask[];
    allDownloadTasks: DownloadTask[];
    finishedFilenames: Record<string, boolean>;
    droppedFilenames: Record<string, boolean>;
    totalChunkCount: number;
    sliceStart?: number;
    sliceEnd?: number;
    isResumed: boolean;
    isDownloaded: boolean;
    isStarted: boolean;
    scheduler?: TaskScheduler<DownloadTask, ExecutedChunk>;
    verboseTimer?: NodeJS.Timeout;
    sigintInstalled: boolean;
}

interface ArchiveContext {
    runtime: DownloadRuntime;
    readonly events: EventEmitter;
    readonly state: ArchiveState;
}

export interface ArchiveDownloadSnapshot extends DownloadSnapshot {
    totalChunkCount: number;
    isResumed: boolean;
}

export interface ArchiveDownloadController {
    download(): Promise<void>;
    resume(taskId: string): Promise<void>;
    getSnapshot(): ArchiveDownloadSnapshot;
    on(event: DownloadEvent, listener: DownloadEventListener): ArchiveDownloadController;
    once(event: DownloadEvent, listener: DownloadEventListener): ArchiveDownloadController;
    off(event: DownloadEvent, listener: DownloadEventListener): ArchiveDownloadController;
}

export function createArchiveDownloader(
    m3u8Path?: string,
    config: ArchiveDownloaderConfig = {}
): ArchiveDownloadController {
    const state: ArchiveState = {
        status: "idle",
        downloadTasks: [],
        allDownloadTasks: [],
        finishedFilenames: {},
        droppedFilenames: {},
        totalChunkCount: 0,
        isResumed: false,
        isDownloaded: false,
        isStarted: false,
        sigintInstalled: false,
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
        resume: (taskId) => resumeArchive(context, taskId),
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
        installArchiveSigintHandler(context);
        if (!runtime.playlist) {
            await runtime.loadInitialPlaylist();
        }
        await prepareNewArchiveDownload(context);
        state.status = "downloading";
        await runArchiveScheduler(context);
    } catch (error) {
        await failArchive(context, error);
        throw error;
    }
}

async function resumeArchive(context: ArchiveContext, taskId: string): Promise<void> {
    if (!context.runtime.config.keepTemporaryFiles) {
        const error = new Error(
            "Archive resume is only supported when temporary chunks are preserved with { keep: true }."
        );
        await failArchive(context, error);
        throw error;
    }
    const previousTask = getTask(taskId.split("?")[0]);
    if (!previousTask) {
        const error = new Error("Can't find a task to resume.");
        logger.error(error.message);
        await failArchive(context, error);
        throw error;
    }
    if (context.state.isStarted) {
        throw new Error("This archive download controller has already been started.");
    }
    context.state.isStarted = true;
    logger.info("Previous task found. Resuming.");

    const currentConfig = context.runtime.config;
    context.runtime = new DownloadRuntime(taskId, {
        threads: previousTask.threads,
        output: previousTask.outputPath,
        key: previousTask.key,
        cookies: previousTask.cookies,
        headers: Object.entries(previousTask.headers || {}).map(([name, value]) => `${name}: ${value}`),
        retries: previousTask.retries,
        proxy: previousTask.proxy,
        verbose: currentConfig.verbose,
        format: currentConfig.format,
        noMerge: currentConfig.noMerge,
        keep: currentConfig.keepTemporaryFiles,
        keepEncryptedChunks: currentConfig.keepEncryptedChunks,
        chunkNamingStrategy: currentConfig.chunkNamingStrategy,
        cliMode: currentConfig.cliMode,
    });
    const { runtime, state } = context;
    state.status = "preparing";
    runtime.useExistingWorkspace(previousTask.tempPath, previousTask.outputPath);
    runtime.progress.restore({
        startedAt: Date.now(),
        finishedChunkCount: previousTask.finishedChunksCount,
        finishedChunkLength: previousTask.finishedChunkLength,
    });
    state.downloadTasks = cloneTasks(previousTask.downloadTasks || []);
    state.allDownloadTasks = cloneTasks(previousTask.allDownloadTasks || state.downloadTasks);
    state.finishedFilenames = previousTask.finishedFilenames || {};
    state.droppedFilenames = previousTask.droppedFilenames || {};
    state.totalChunkCount = previousTask.totalChunksCount || state.allDownloadTasks.length;
    state.isResumed = true;
    installArchiveSigintHandler(context);

    try {
        await runtime.loadInitialPlaylist();
        await prepareArchiveSiteAndKeys(context);
        initializeArchiveTaskStatuses(context, state.allDownloadTasks);
        restoreCompletedArchiveOutputs(context);
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
    state.allDownloadTasks = cloneTasks(state.downloadTasks);
    state.totalChunkCount = state.downloadTasks.length;
    initializeArchiveTaskStatuses(context, state.allDownloadTasks);
}

async function prepareArchiveSiteAndKeys(context: ArchiveContext) {
    const { runtime, events } = context;
    await runtime.prepareSite("archive");
    events.emit("parsed");
    await runtime.checkKeys();
}

function initializeArchiveTaskStatuses(context: ArchiveContext, tasks: DownloadTask[]): void {
    const { runtime, state } = context;
    const maxId = tasks.reduce((highest, task) => Math.max(highest, task.id), -1);
    for (let id = 0; id <= maxId; id++) {
        runtime.taskStatusRecord[id] = TaskStatus.DROPPED;
    }
    for (const task of tasks) {
        runtime.taskStatusRecord[task.id] = state.droppedFilenames[task.filename]
            ? TaskStatus.DROPPED
            : state.finishedFilenames[task.filename]
            ? TaskStatus.DONE
            : TaskStatus.PENDING;
    }
}

function restoreCompletedArchiveOutputs(context: ArchiveContext): void {
    const { runtime, state } = context;
    if (runtime.config.noMerge) {
        return;
    }
    for (const task of state.allDownloadTasks) {
        if (!state.finishedFilenames[task.filename] || state.droppedFilenames[task.filename]) {
            continue;
        }
        const outputPath = runtime.getTaskOutputPath(task);
        if (!fs.existsSync(outputPath)) {
            throw new Error(
                `Cannot safely resume because completed chunk '${task.filename}' is missing from '${runtime.tempPath}'.`
            );
        }
        runtime.markOutputReady(task, outputPath);
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
    state.finishedFilenames[task.filename] = true;
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
    const { runtime, state, events } = context;
    events.emit("chunk-error", error, task.filename);
    task.retryCount = task.retryCount ? task.retryCount + 1 : 1;
    if (runtime.dropChunksOnMaxRetries && task.retryCount >= runtime.config.retries) {
        runtime.markDropped(task);
        runtime.progress.recordDropped();
        state.finishedFilenames[task.filename] = true;
        state.droppedFilenames[task.filename] = true;
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
    saveArchiveTaskStatus(context);

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
    try {
        deleteTask(runtime.sourcePath.split("?")[0]);
    } catch (error) {
        logger.warning("Fail to delete previous task status, ignored.");
        logger.warning((error as Error).message);
    }
    logArchiveOutputPaths(outputPaths);
    state.status = "finished";
    events.emit("finished");
}

function saveArchiveTaskStatus(context: ArchiveContext): void {
    const { runtime, state } = context;
    const unfinishedTasks = state.allDownloadTasks.filter((task) => !state.finishedFilenames[task.filename]);
    const unfinishedTaskCount = unfinishedTasks.length;
    logger.info(`Downloaded: ${runtime.progress.finishedChunkCount}; Waiting for download: ${unfinishedTaskCount}`);

    try {
        saveTask({
            id: runtime.sourcePath.split("?")[0],
            tempPath: runtime.tempPath,
            m3u8Path: runtime.sourcePath,
            outputPath: runtime.outputPath,
            threads: runtime.config.threads,
            cookies: runtime.config.cookies,
            headers: runtime.config.headers,
            key: runtime.config.key,
            startedAt: runtime.progress.startedAt,
            finishedChunksCount: state.totalChunkCount - unfinishedTaskCount,
            finishedChunkLength: runtime.progress.finishedChunkLength,
            totalChunksCount: state.totalChunkCount,
            retries: runtime.config.retries,
            timeout: runtime.timeout,
            proxy: runtime.config.proxy,
            downloadTasks: cloneTasks(unfinishedTasks),
            allDownloadTasks: cloneTasks(state.allDownloadTasks),
            finishedFilenames: state.finishedFilenames,
            droppedFilenames: state.droppedFilenames,
        });
    } catch (error) {
        logger.warning("Fail to save previous task status, ignored.");
        logger.warning((error as Error).message);
    }
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
        isResumed: state.isResumed,
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

function installArchiveSigintHandler(context: ArchiveContext): void {
    const { runtime, state, events } = context;
    if (!runtime.config.cliMode || state.sigintInstalled) {
        return;
    }
    state.sigintInstalled = true;
    process.on("SIGINT", () => {
        state.status = "stopping";
        logger.info("Saving task status.");
        saveArchiveTaskStatus(context);
        logger.info("Please wait.");
        events.emit("finished");
    });
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
