import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import axios from "axios";
import { deleteEmptyDirectory } from "../utils/system";
import { saveTask, deleteTask, getTask } from "../utils/task";
import { timeStringToSeconds } from "../utils/time";
import logger from "../utils/log";
import { isInitialChunk, Playlist } from "./m3u8";
import Downloader, {
    ArchiveDownloaderConfig,
    DownloadTaskItem,
    isTaskGroup,
    DownloadTask,
    DownloadTaskGroup,
} from "./downloader";
import { getFileExt } from "../utils/common";
import { TaskStatus } from "./file_concentrator";

class ArchiveDownloader extends Downloader {
    tempPath: string;
    m3u8Path: string;
    m3u8: Playlist;

    downloadTasks: DownloadTaskItem[] = [];
    allDownloadTasks: DownloadTaskItem[] = [];
    // 使用 Object 的原因是使用数组，检索需要遍历数组 1/2 * n^2 次
    // 当有数千块的时候有那么一点点不可接受
    finishedFilenames: { [index: string]: any } = {};

    totalChunksCount: number;
    runningThreads: number = 0;

    sliceStart: number;
    sliceEnd: number;

    prefix: string;

    isResumed: boolean = false; // 是否为恢复模式
    isDownloaded: boolean = false;

    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(
        m3u8Path?: string,
        {
            threads,
            output,
            tempDir,
            key,
            verbose,
            retries,
            proxy,
            slice,
            format,
            cookies,
            headers,
            keep,
            noMerge,
            keepEncryptedChunks,
            chunkNamingStrategy,
            cliMode,
        }: ArchiveDownloaderConfig = {}
    ) {
        super(m3u8Path, {
            threads: threads || 5,
            output,
            tempDir,
            key,
            verbose,
            retries,
            proxy,
            format,
            cookies,
            headers,
            keep,
            noMerge,
            keepEncryptedChunks,
            chunkNamingStrategy,
            cliMode,
        });
        if (slice) {
            this.sliceStart = timeStringToSeconds(slice.split("-")[0]);
            this.sliceEnd = timeStringToSeconds(slice.split("-")[1]);
        }
    }

    /**
     * Parse M3U8 Information
     */
    async parse() {
        // parse m3u8
        if (this.m3u8.encryptKeys.length > 0) {
            // Encrypted
            const key = this.m3u8.encryptKeys[0];
            if (key.startsWith("abematv-license")) {
                logger.info("Site comfirmed: AbemaTV.");
                const parser = await import("./parsers/abema");
                parser.default.parse({
                    downloader: this,
                });
            } else if (this.m3u8Path.includes("d22puzix29w08m")) {
                logger.info("Site comfirmed: Hibiki-Radio.");
                const parser = await import("./parsers/hibiki");
                parser.default.parse({
                    downloader: this,
                });
            } else {
                logger.warning(`Site is not supported by Minyami Core. Try common parser.`);
                try {
                    const parser = await import("./parsers/common");
                    await parser.default.parse({
                        downloader: this,
                    });
                } catch (e) {
                    logger.error("Aborted due to critical error.", e);
                    this.emit("critical-error", e);
                }
            }
        } else {
            // Not encrypted
            if (this.m3u8Path.includes("dmc.nico")) {
                // NicoNico
                if (this.m3u8.m3u8Content.includes("#EXT-X-PLAYLIST-TYPE:VOD")) {
                    logger.info("Site comfirmed: NicoVideo.");
                    try {
                        const parser = await import("./parsers/common");
                        await parser.default.parse({
                            downloader: this,
                        });
                    } catch (e) {
                        logger.error("Aborted due to critical error.", e);
                        this.emit("critical-error", e);
                    }
                } else {
                    logger.info("Site comfirmed: NicoLive.");
                    const parser = await import("./parsers/nico");
                    if (!this.key) {
                        logger.info("请保持播放页面不要关闭");
                        logger.info("Please do not close the video page.");
                        logger.info(`Maybe you should get a audience token to get a better user experience.`);
                    }
                    if (this.threads > 10) {
                        logger.warning(`High threads setting detected. Use at your own risk!`);
                    }
                    parser.default.parse({
                        downloader: this,
                    });
                    this.autoGenerateChunkList = false;
                }
            } else if (this.m3u8Path.includes("googlevideo")) {
                // YouTube
                logger.info("Site comfirmed: YouTube.");
                const parser = await import("./parsers/youtube");
                parser.default.parse({
                    downloader: this,
                });
            } else {
                logger.warning(`Site is not supported by Minyami Core. Try common parser.`);
                try {
                    const parser = await import("./parsers/common");
                    await parser.default.parse({
                        downloader: this,
                    });
                } catch (e) {
                    logger.error("Aborted due to critical error.", e);
                    this.emit("critical-error", e);
                }
            }
        }
    }

    async download() {
        // Record start time to calculate speed.
        this.startedAt = new Date().valueOf();
        // Allocate temporary directory.
        this.tempPath = path.resolve(this.tempPath, "minyami_" + new Date().valueOf());

        if (!fs.existsSync(this.tempPath)) {
            fs.mkdirSync(this.tempPath);
        }

        if (this.cliMode) {
            process.on("SIGINT", async () => {
                await this.clean();
                this.emit("finished");
            });
        }

        try {
            await this.parse();
            await this.checkKeys();
        } catch (e) {
            logger.error("Failed to parse M3U8 file.");
            logger.debug(e);
            return;
        }

        logger.info(`Start downloading with ${this.threads} thread(s).`);
        if (this.autoGenerateChunkList) {
            this.downloadTasks = this.m3u8.chunks.map((chunk, index) => {
                const ext = getFileExt(chunk.url);
                return {
                    url: chunk.url,
                    filename: this.onTaskOutputFileNaming(chunk, index),
                    retryCount: 0,
                    chunk,
                    id: index,
                };
            });
        }
        if (this.sliceStart !== undefined && this.sliceEnd !== undefined) {
            const newChunkList: DownloadTaskItem[] = [];
            let nowTime = 0;
            for (const task of this.downloadTasks) {
                if (nowTime > this.sliceEnd) {
                    break;
                }
                if (isTaskGroup(task)) {
                    const chunkGroupTotalLength = task.subTasks.reduce(
                        (prevLength, t) => prevLength + (isInitialChunk(t.chunk) ? 0 : t.chunk.length),
                        0
                    );
                    // 处理一组块
                    if (nowTime + chunkGroupTotalLength < this.sliceStart) {
                        // 加上整个块都还没有到开始时间
                        nowTime += chunkGroupTotalLength;
                        continue;
                    } else {
                        // 组中至少有一个已经在时间范围内
                        const newChunkItem: DownloadTaskItem = {
                            actions: task.actions,
                            subTasks: [],
                            isFinished: false,
                            isNew: true,
                        };
                        for (const t of task.subTasks) {
                            if (isInitialChunk(t.chunk)) {
                                newChunkItem.subTasks.push(t);
                                continue;
                            }
                            if (
                                nowTime + t.chunk.length >= this.sliceStart &&
                                nowTime + t.chunk.length < this.sliceEnd
                            ) {
                                // 添加已经在时间范围内的块
                                newChunkItem.subTasks.push(t);
                                nowTime += t.chunk.length;
                            } else {
                                // 跳过时间范围外的块
                                nowTime += t.chunk.length;
                                continue;
                            }
                        }
                        newChunkList.push(newChunkItem);
                    }
                } else {
                    if (isInitialChunk(task.chunk)) {
                        newChunkList.push(task);
                    } else {
                        // 处理普通块
                        if (nowTime >= this.sliceStart) {
                            newChunkList.push(task);
                            nowTime += task.chunk.length;
                        } else {
                            nowTime += task.chunk.length;
                        }
                    }
                }
            }

            this.downloadTasks = newChunkList;

            // Mark skipped chunks as dropped
            const firstTask = isTaskGroup(this.downloadTasks[0])
                ? this.downloadTasks[0].subTasks[0]
                : this.downloadTasks[0];
            if (firstTask.id > 0) {
                for (let i = 0; i < firstTask.id; i++) {
                    this.taskStatusRecord[i] = TaskStatus.DROPPED;
                }
            } else if (firstTask.chunk.isInitialChunk) {
                // re-index chunks
                if (isTaskGroup(this.downloadTasks[0])) {
                    // TODO: not supported
                    logger.error("TaskGroup is not supported when initial segment is provided.");
                    return;
                } else {
                    this.downloadTasks.slice(1).forEach((task, index) => {
                        if (!isTaskGroup(task)) {
                            task.id = index;
                        }
                    });
                }
            }
        }

        this.allDownloadTasks = this.downloadTasks.map((task) => {
            if (isTaskGroup(task)) {
                return {
                    ...task,
                    subTasks: [...task.subTasks],
                };
            } else {
                return task;
            }
        });

        this.totalChunksCount = 0;
        for (const chunk of this.downloadTasks) {
            this.totalChunksCount += isTaskGroup(chunk) ? chunk.subTasks.length : 1;
        }

        if (this.verbose) {
            setInterval(() => {
                logger.debug(
                    `Now running threads: ${this.runningThreads}, finished chunks: ${this.finishedChunkCount}, total chunks: ${this.totalChunksCount}`
                );
            }, 3000);
        }
        this.checkQueue();
    }

    /**
     * calculate ETA
     */
    getETA() {
        const usedTime = new Date().valueOf() - this.startedAt;
        const remainingTimeInSeconds = Math.round(
            ((usedTime / this.finishedChunkCount) * this.totalChunksCount - usedTime) / 1000
        );
        if (remainingTimeInSeconds < 60) {
            return `${remainingTimeInSeconds}s`;
        } else if (remainingTimeInSeconds < 3600) {
            return `${Math.floor(remainingTimeInSeconds / 60)}m ${remainingTimeInSeconds % 60}s`;
        } else {
            return `${Math.floor(remainingTimeInSeconds / 3600)}h ${Math.floor(
                (remainingTimeInSeconds % 3600) / 60
            )}m ${remainingTimeInSeconds % 60}s`;
        }
    }

    /**
     * Check task queue
     */
    async checkQueue() {
        if (this.downloadTasks.length > 0 && this.runningThreads < this.threads) {
            const firstTask = this.downloadTasks[0];
            let task: DownloadTask;
            if (isTaskGroup(firstTask)) {
                if (firstTask.actions && firstTask.isNew) {
                    logger.debug(`Handle chunk actions for a new chunk group.`);
                    firstTask.isNew = false;
                    for (const action of firstTask.actions) {
                        await this.handleChunkGroupAction(action);
                    }
                    this.checkQueue();
                    return;
                }
                if (firstTask.subTasks.length > 0) {
                    task = firstTask.subTasks.shift();
                    task.parentGroup = firstTask;
                    if (task.parentGroup.retryActions) {
                        for (const action of task.parentGroup.actions) {
                            await this.handleChunkGroupAction(action);
                        }
                        task.parentGroup.retryActions = false;
                    }
                } else {
                    // All chunks finished in group
                    logger.debug(`Skip a empty chunk group.`);
                    firstTask.isFinished = true;
                    this.downloadTasks.shift();
                    this.checkQueue();
                    return;
                }
            } else {
                task = this.downloadTasks.shift() as DownloadTask;
                // this.chunks.shift();
            }
            this.runningThreads++;
            this.handleTask(task)
                .then(() => {
                    this.runningThreads--;
                    const currentChunkInfo = {
                        taskname: task.filename,
                        finishedChunksCount: this.finishedChunkCount,
                        totalChunksCount: this.totalChunksCount,
                        chunkSpeed: this.calculateSpeedByChunk(),
                        ratioSpeed: this.calculateSpeedByRatio(),
                        eta: this.getETA(),
                    };

                    logger.info(
                        `Processing ${currentChunkInfo.taskname} finished. (${currentChunkInfo.finishedChunksCount} / ${
                            this.totalChunksCount
                        } or ${(
                            (currentChunkInfo.finishedChunksCount / currentChunkInfo.totalChunksCount) *
                            100
                        ).toFixed(2)}% | Avg Speed: ${currentChunkInfo.chunkSpeed} chunks/s or ${
                            currentChunkInfo.ratioSpeed
                        }x | ETA: ${currentChunkInfo.eta})`
                    );
                    this.finishedFilenames[task.filename] = true;
                    if (!this.noMerge) {
                        this.fileConcentrator.addTasks([
                            {
                                filePath: task.chunk.isEncrypted
                                    ? path.resolve(this.tempPath, `./${task.filename}.decrypt`)
                                    : path.resolve(this.tempPath, `./${task.filename}`),
                                index: task.id,
                            },
                        ]);
                        this.taskStatusRecord[task.id] = TaskStatus.DONE;
                    }
                    this.emit("chunk-downloaded", currentChunkInfo);
                    this.checkQueue();
                })
                .catch((e) => {
                    this.emit("chunk-error", e, task.filename);
                    this.runningThreads--;
                    // 重试计数
                    task.retryCount = task.retryCount ? task.retryCount + 1 : 1;
                    if (task.parentGroup) {
                        if (task.parentGroup.isFinished) {
                            // Add a new group to the queue.
                            this.downloadTasks.unshift({
                                subTasks: [task],
                                actions: task.parentGroup.actions,
                                isFinished: false,
                                isNew: true,
                            } as DownloadTaskGroup);
                        } else {
                            task.parentGroup.retryActions = true;
                            task.parentGroup.subTasks.unshift(task);
                        }
                    } else {
                        this.downloadTasks.unshift(task);
                    }
                    this.checkQueue();
                });
            this.checkQueue();
        }
        if (
            this.downloadTasks.length === 0 &&
            this.totalChunksCount === this.finishedChunkCount &&
            this.runningThreads === 0
        ) {
            if (this.isDownloaded) {
                return;
            }
            this.isDownloaded = true;
            logger.info("All chunks downloaded. Start merging chunks.");
            this.emit("downloaded");
            this.saveTask();
            if (this.noMerge) {
                logger.info("Skip merging. Please merge video chunks manually.");
                logger.info(`Temporary files are located at ${this.tempPath}`);
                this.emit("finished");
                return;
            }
            logger.info("Merging chunks...");
            await this.fileConcentrator.waitAllFilesWritten();
            if (!this.keepTemporaryFiles) {
                logger.info("End of merging.");
                logger.info("Starting cleaning temporary files.");
                try {
                    await deleteEmptyDirectory(this.tempPath);
                } catch (e) {
                    logger.warning(
                        `Fail to delete temporary files, please delete manually or execute "minyami --clean" later.`
                    );
                }
            }
            try {
                deleteTask(this.m3u8Path.split("?")[0]);
            } catch (error) {
                logger.warning("Fail to parse previous tasks, ignored.");
                logger.warning(error.message);
            }
            const outputPaths = this.fileConcentrator.getOutputFilePaths();
            if (outputPaths.length === 1) {
                logger.info(`All finished. Please checkout your files at [${path.resolve(outputPaths[0])}]`);
            } else {
                logger.info(
                    `All finished. Please checkout your files at ${outputPaths
                        .map((p) => `[${path.resolve(p)}]`)
                        .join(", ")}.`
                );
            }
            this.emit("finished");
        }
    }

    async resume(taskId: string) {
        const previousTask = getTask(taskId.split("?")[0]);
        if (!previousTask) {
            logger.error("Can't find a task to resume.");
            this.emit("critical-error", new Error("Can't find a task to resume."));
        }
        logger.info("Previous task found. Resuming.");

        if (this.cliMode) {
            process.on("SIGINT", async () => {
                await this.clean();
                this.emit("finished");
            });
        }

        this.m3u8Path = taskId;
        // Resume status
        this.tempPath = previousTask.tempPath;
        this.outputPath = previousTask.outputPath;
        this.threads = previousTask.threads;
        this.cookies = previousTask.cookies;
        this.headers = previousTask.headers;
        this.key = previousTask.key;
        this.verbose = previousTask.verbose;
        this.startedAt = new Date().valueOf();
        this.totalChunksCount = previousTask.totalChunksCount - previousTask.finishedChunksCount;
        this.retries = previousTask.retries;
        this.timeout = previousTask.timeout;
        this.proxy = previousTask.proxy;
        this.allDownloadTasks = previousTask.allDownloadTasks;
        this.downloadTasks = previousTask.downloadTasks;
        this.finishedFilenames = previousTask.finishedFilenames;
        if (this.headers && Object.keys(this.headers).length > 0) {
            // Apply global custom headers
            axios.defaults.headers.common = {
                ...axios.defaults.headers.common,
                ...(this.cookies ? { Cookie: this.cookies } : {}), // Cookies 优先级低于 Custom Headers
                ...this.headers,
            };
        }
        // Load M3U8
        await this.loadM3U8();
        try {
            await this.parse();
            await this.checkKeys();
        } catch (e) {
            logger.error("Fail to parse M3U8 file.");
            logger.debug(e);
            return;
        }

        this.isResumed = true;

        logger.info(`Start downloading with ${this.threads} thread(s).`);
        this.checkQueue();
    }

    /**
     * 退出前的清理工作
     */
    async clean() {
        logger.info("Saving task status.");
        this.saveTask();
        logger.info("Please wait.");
    }

    saveTask() {
        const unfinishedTasks: DownloadTaskItem[] = [];
        this.allDownloadTasks.forEach((task) => {
            if (isTaskGroup(task)) {
                let allFinishedFlag = true;
                const unfinishedTasksInGroup: DownloadTask[] = [];
                for (const subTask of task.subTasks) {
                    if (!this.finishedFilenames[subTask.filename]) {
                        allFinishedFlag = false;
                        unfinishedTasksInGroup.push(subTask);
                    }
                }
                if (!allFinishedFlag) {
                    // 组中块未全部完成 加入未完成列表
                    unfinishedTasks.push({
                        ...task,
                        subTasks: unfinishedTasksInGroup,
                    });
                }
            } else {
                if (!this.finishedFilenames[task.filename]) {
                    unfinishedTasks.push(task);
                }
            }
        });

        let unfinishedTaskCount = 0;
        for (const task of unfinishedTasks) {
            unfinishedTaskCount += isTaskGroup(task) ? task.subTasks.length : 1;
        }

        logger.info(`Downloaded: ${this.finishedChunkCount}; Waiting for download: ${unfinishedTaskCount}`);

        try {
            saveTask({
                id: this.m3u8Path.split("?")[0],
                tempPath: this.tempPath,
                m3u8Path: this.m3u8Path,
                outputPath: this.outputPath,
                threads: this.threads,
                cookies: this.cookies,
                headers: this.headers,
                key: this.key,
                verbose: this.verbose,
                startedAt: this.startedAt,
                finishedChunksCount: this.totalChunksCount - unfinishedTaskCount,
                finishedChunkLength: this.finishedChunkLength,
                totalChunksCount: this.totalChunksCount,
                retries: this.retries,
                timeout: this.timeout,
                proxy: this.proxy,
                downloadTasks: unfinishedTasks,
                allDownloadTasks: this.allDownloadTasks,
                finishedFilenames: this.finishedFilenames,
            });
        } catch (error) {
            logger.warning("Fail to parse previous tasks, ignored.");
            logger.warning(error.message);
        }
    }
}

export default ArchiveDownloader;
