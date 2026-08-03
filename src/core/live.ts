import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import logger from "../utils/log";
import { deleteEmptyDirectory, sleep } from "../utils/system";
import { DownloadTask, LiveDownloaderConfig } from "./downloader";
import { TaskStatus } from "./file_concentrator";
import { isNormalChunk } from "./m3u8";
import { DownloadEvent, DownloadEventListener, DownloadSnapshot, DownloadStatus } from "./download/controller";
import { DownloadRuntime, ExecutedChunk } from "./download/runtime";
import { TaskScheduler } from "./download/task_scheduler";

interface LiveState {
    status: DownloadStatus;
    readonly initialChunkUrls: Set<string>;
    readonly sequenceIds: Set<number>;
    downloadTasks: DownloadTask[];
    allDownloadTasks: DownloadTask[];
    totalChunkCount: number;
    isEnd: boolean;
    isDownloadFinished: boolean;
    isStarted: boolean;
    forceStop: boolean;
    scheduler?: TaskScheduler<DownloadTask, ExecutedChunk>;
    verboseTimer?: NodeJS.Timeout;
    sigintInstalled: boolean;
}

interface LiveContext {
    readonly runtime: DownloadRuntime;
    readonly events: EventEmitter;
    readonly state: LiveState;
}

export interface LiveDownloadSnapshot extends DownloadSnapshot {
    totalChunkCount: number;
    isEnd: boolean;
}

export interface LiveDownloadController {
    download(): Promise<void>;
    stop(): void;
    getSnapshot(): LiveDownloadSnapshot;
    on(event: DownloadEvent, listener: DownloadEventListener): LiveDownloadController;
    once(event: DownloadEvent, listener: DownloadEventListener): LiveDownloadController;
    off(event: DownloadEvent, listener: DownloadEventListener): LiveDownloadController;
}

export function createLiveDownloader(m3u8Path: string, config: LiveDownloaderConfig = {}): LiveDownloadController {
    const context: LiveContext = {
        runtime: new DownloadRuntime(m3u8Path, config),
        events: new EventEmitter(),
        state: {
            status: "idle",
            initialChunkUrls: new Set<string>(),
            sequenceIds: new Set<number>(),
            downloadTasks: [],
            allDownloadTasks: [],
            totalChunkCount: 0,
            isEnd: false,
            isDownloadFinished: false,
            isStarted: false,
            forceStop: false,
            sigintInstalled: false,
        },
    };
    const controller: LiveDownloadController = {
        download: () => downloadLive(context),
        stop: () => stopLive(context),
        getSnapshot: () => getLiveSnapshot(context),
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

async function downloadLive(context: LiveContext): Promise<void> {
    const { runtime, state, events } = context;
    if (state.isStarted) {
        throw new Error("This live download controller has already been started.");
    }
    state.isStarted = true;
    state.status = "preparing";
    runtime.progress.start();
    try {
        await runtime.allocateWorkspace();
        installLiveSigintHandler(context);
        await runtime.loadInitialPlaylist();
        updateLiveTimeouts(context);
        await runtime.prepareSite("live");
        events.emit("parsed");
        await runtime.checkKeys();
        createLiveScheduler(context);
        const completion = state.scheduler.start();

        if (runtime.config.verbose) {
            state.verboseTimer = setInterval(() => {
                logger.debug(
                    `Waiting tasks: ${state.scheduler.pendingCount}, finished chunks: ${runtime.progress.finishedChunkCount}`
                );
                saveLiveTask(context);
            }, 3000);
        }

        state.status = "downloading";
        await cycleLivePlaylist(context);
        state.scheduler.close();
        await completion;
        await finishLiveDownload(context);
    } catch (error) {
        await failLive(context, error);
        throw error;
    }
}

async function cycleLivePlaylist(context: LiveContext): Promise<void> {
    const { runtime, state } = context;
    while (!state.isEnd) {
        if (runtime.playlist.isEnd) {
            logger.info("Stream ended. Waiting for current tasks finished.");
            state.isEnd = true;
        }

        const chunks = runtime.playlist.chunks.filter((chunk) => {
            if (isNormalChunk(chunk)) {
                if (state.sequenceIds.has(chunk.sequenceId)) {
                    return false;
                }
                state.sequenceIds.add(chunk.sequenceId);
                return true;
            }
            if (state.initialChunkUrls.has(chunk.url)) {
                return false;
            }
            state.initialChunkUrls.add(chunk.url);
            return true;
        });
        logger.debug(`Get ${chunks.length} new chunk(s).`);

        const newTasks = chunks.map((chunk, index): DownloadTask => {
            const id = state.totalChunkCount + index;
            return {
                filename: runtime.nameChunk(chunk, id),
                retryCount: 0,
                chunk,
                id,
            };
        });
        for (const task of newTasks) {
            runtime.taskStatusRecord[task.id] = TaskStatus.PENDING;
        }
        state.downloadTasks.push(...newTasks);
        state.allDownloadTasks.push(...newTasks);
        state.totalChunkCount += newTasks.length;
        if (newTasks.length > 0) {
            state.scheduler.add(newTasks);
        }

        if (state.isEnd) {
            break;
        }
        await refreshLivePlaylist(context);
        await runtime.checkKeys();
        logger.debug("Cool down... Wait for next check");
        await sleep(Math.min(5000, safeLiveChunkLength(context) * 1000));
    }
}

async function refreshLivePlaylist(context: LiveContext): Promise<void> {
    const { runtime, state } = context;
    try {
        await runtime.refreshPlaylist(state.totalChunkCount);
    } catch (error) {
        const status = (error as any)?.response?.status;
        if (runtime.progress.finishedChunkCount > 0) {
            if (status >= 400 && status <= 599) {
                logger.info("M3U8 file is no longer available. Stop downloading.");
                state.isEnd = true;
            } else {
                logger.warning("Unable to refresh M3U8 file. Keep the current playlist and retry later.");
            }
            return;
        }
        throw error;
    }
}

function createLiveScheduler(context: LiveContext): void {
    const { runtime, state } = context;
    state.scheduler = new TaskScheduler<DownloadTask, ExecutedChunk>({
        concurrency: runtime.config.threads,
        execute: (task) => runtime.execute(task),
        onSuccess: (task, result) => onLiveTaskSuccess(context, task, result),
        onError: (task, error) => onLiveTaskError(context, task, error),
    });
}

async function onLiveTaskSuccess(context: LiveContext, task: DownloadTask, result: ExecutedChunk): Promise<void> {
    const { runtime, state, events } = context;
    runtime.recordFinished(task);
    runtime.markOutputReady(task, result.outputPath);
    state.downloadTasks = state.downloadTasks.filter((queuedTask) => queuedTask.id !== task.id);
    const chunkInfo = {
        taskname: task.filename,
        finishedChunksCount: runtime.progress.finishedChunkCount,
        chunkSpeed: runtime.progress.speedByChunk(),
        ratioSpeed: runtime.progress.speedByRatio(),
    };
    logger.info(
        `Processing ${chunkInfo.taskname} finished. (${chunkInfo.finishedChunksCount} chunks downloaded | Avg Speed: ${chunkInfo.chunkSpeed} chunks/s or ${chunkInfo.ratioSpeed}x)`
    );
    events.emit("chunk-downloaded", chunkInfo);
}

function onLiveTaskError(context: LiveContext, task: DownloadTask, error: unknown): boolean {
    const { runtime, state, events } = context;
    events.emit("chunk-error", error, task.filename);
    task.retryCount = task.retryCount ? task.retryCount + 1 : 1;
    if (task.retryCount >= runtime.config.retries) {
        runtime.markDropped(task);
        state.downloadTasks = state.downloadTasks.filter((queuedTask) => queuedTask.id !== task.id);
        logger.warning(`Processing ${task.filename} failed, max retries exceed, drop.`);
        return false;
    }
    logger.warning(`Processing ${task.filename} failed, retry later.`);
    return true;
}

async function finishLiveDownload(context: LiveContext): Promise<void> {
    const { runtime, state, events } = context;
    if (state.isDownloadFinished) {
        return;
    }
    state.isDownloadFinished = true;
    clearLiveVerboseTimer(state);
    events.emit("downloaded");
    if (runtime.config.noMerge || runtime.config.keepTemporaryFiles) {
        saveLiveTask(context);
    }
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
    logLiveOutputPaths(outputPaths);
    state.status = "finished";
    events.emit("finished");
}

function saveLiveTask(context: LiveContext): void {
    const { runtime, state } = context;
    if (!runtime.tempPath || !fs.existsSync(runtime.tempPath)) {
        return;
    }
    const taskInfo = {
        tempPath: runtime.tempPath,
        m3u8Path: runtime.sourcePath,
        outputPath: runtime.outputPath,
        threads: runtime.config.threads,
        cookies: runtime.config.cookies,
        headers: runtime.config.headers,
        key: runtime.config.key,
        verbose: runtime.config.verbose,
        startedAt: runtime.progress.startedAt,
        retries: runtime.config.retries,
        timeout: runtime.timeout,
        proxy: runtime.config.proxy,
        downloadTasks: state.allDownloadTasks,
    };
    try {
        fs.writeFileSync(path.resolve(runtime.tempPath, "task.json"), JSON.stringify(taskInfo, null, 2));
    } catch (error) {
        logger.warning("Fail to save task info.");
        logger.debug(error);
    }
}

function stopLive(context: LiveContext): void {
    if (context.state.status === "finished" || context.state.status === "failed") {
        return;
    }
    context.state.status = "stopping";
    context.state.isEnd = true;
}

function getLiveSnapshot(context: LiveContext): LiveDownloadSnapshot {
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
        pendingTaskCount: state.scheduler?.pendingCount || state.downloadTasks.length,
        totalChunkCount: state.totalChunkCount,
        isEnd: state.isEnd,
    };
}

function updateLiveTimeouts(context: LiveContext): void {
    const { runtime } = context;
    const chunkLength = safeLiveChunkLength(context);
    runtime.timeout = Math.min(Math.max(20000, runtime.playlist.chunks.length * chunkLength * 1000), 60000);
    runtime.chunkTimeout = Math.min(chunkLength * 1000 * 20, 60000);
}

function safeLiveChunkLength(context: LiveContext): number {
    const chunkLength = context.runtime.playlist.getChunkLength();
    return Number.isFinite(chunkLength) && chunkLength > 0 ? chunkLength : 5;
}

function installLiveSigintHandler(context: LiveContext): void {
    const { runtime, state, events } = context;
    if (!runtime.config.cliMode || state.sigintInstalled) {
        return;
    }
    state.sigintInstalled = true;
    process.on("SIGINT", async () => {
        if (!state.forceStop) {
            logger.info("Ctrl+C pressed, waiting for tasks finished.");
            state.forceStop = true;
            stopLive(context);
            return;
        }
        logger.info("Force stopped.");
        logger.info(`Your temporary files are located at [${path.resolve(runtime.tempPath)}]`);
        state.scheduler?.abort();
        saveLiveTask(context);
        if (!state.isDownloadFinished) {
            state.isDownloadFinished = true;
            state.status = "finished";
            events.emit("finished");
        }
    });
}

async function failLive(context: LiveContext, error: unknown): Promise<void> {
    const { runtime, state, events } = context;
    clearLiveVerboseTimer(state);
    state.status = "failed";
    logger.error("Aborted due to critical error.", error as Error);
    if (runtime.tempPath) {
        logger.info(`Your temporary files are located at [${path.resolve(runtime.tempPath)}]`);
        saveLiveTask(context);
    }
    events.emit("critical-error", error);
}

function clearLiveVerboseTimer(state: LiveState): void {
    if (state.verboseTimer) {
        clearInterval(state.verboseTimer);
        state.verboseTimer = undefined;
    }
}

function logLiveOutputPaths(outputPaths: string[]): void {
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
