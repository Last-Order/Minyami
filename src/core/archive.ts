import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import axios from "axios";
import { mergeToMKV, mergeToTS } from "../utils/media";
import { deleteDirectory } from "../utils/system";
import { saveTask, deleteTask, getTask } from "../utils/task";
import { timeStringToSeconds } from "../utils/time";
import logger from "../utils/log";
import { Playlist } from "./m3u8";
import Downloader, { ArchiveDownloaderConfig, ChunkItem, isChunkGroup, Chunk, ChunkGroup } from "./downloader";

class ArchiveDownloader extends Downloader {
    tempPath: string;
    m3u8Path: string;
    m3u8: Playlist;

    chunks: ChunkItem[] = [];
    allChunks: ChunkItem[] = [];
    pickedChunks: ChunkItem[] = [];
    // 使用 Object 的原因是使用数组，检索需要遍历数组 1/2 * n^2 次
    // 当有数千块的时候有那么一点点不可接受
    finishedFilenames: { [index: string]: any } = {};
    outputFileList: string[];

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
            key,
            verbose,
            retries,
            proxy,
            slice,
            format,
            cookies,
            headers,
            nomerge,
            cliMode,
        }: ArchiveDownloaderConfig = {}
    ) {
        super(m3u8Path, {
            threads: threads || 5,
            output,
            key,
            verbose,
            retries,
            proxy,
            format,
            cookies,
            headers,
            nomerge,
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
            } else if (this.m3u8Path.includes("dmm.com")) {
                logger.info("Site comfirmed: DMM.");
                const parser = await import("./parsers/dmm");
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
                const parser = await import("./parsers/common");
                await parser.default.parse({
                    downloader: this,
                });
            }
        } else {
            // Not encrypted
            if (this.m3u8Path.includes("dmc.nico")) {
                // NicoNico
                logger.info("Site comfirmed: NicoNico.");
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
                    this.emit("critical-error");
                }
            }
        }
    }

    async download() {
        // Record start time to calculate speed.
        this.startedAt = new Date().valueOf();
        // Allocate temporary directory.
        this.tempPath = path.resolve(os.tmpdir(), "minyami_" + new Date().valueOf());

        if (!fs.existsSync(this.tempPath)) {
            fs.mkdirSync(this.tempPath);
        }

        if (this.cliMode) {
            process.on("SIGINT", async () => {
                await this.clean();
                this.emit("finished");
            });
        }

        await this.parse();

        logger.info(`Start downloading with ${this.threads} thread(s).`);
        if (this.autoGenerateChunkList) {
            this.chunks = this.m3u8.chunks.map((chunk) => {
                const filename = this.onChunkNaming(chunk);
                return chunk.isEncrypted
                    ? {
                          url: chunk.url,
                          filename,
                          key: chunk.key,
                          iv: chunk.iv,
                          sequenceId: chunk.sequenceId,
                          isEncrypted: true,
                          length: chunk.length,
                      }
                    : {
                          url: chunk.url,
                          filename,
                          sequenceId: chunk.sequenceId,
                          isEncrypted: false,
                          length: chunk.length,
                      };
            });
        }
        if (this.sliceStart !== undefined && this.sliceEnd !== undefined) {
            const newChunkList: ChunkItem[] = [];
            let nowTime = 0;
            for (const chunk of this.chunks) {
                if (nowTime > this.sliceEnd) {
                    break;
                }
                if (isChunkGroup(chunk)) {
                    // 处理一组块
                    if (nowTime + chunk.chunks.length * this.m3u8.getChunkLength() < this.sliceStart) {
                        // 加上整个块都还没有到开始时间
                        nowTime += chunk.chunks.length * this.m3u8.getChunkLength();
                        continue;
                    } else {
                        // 组中至少有一个已经在时间范围内
                        const newChunkItem: ChunkItem = {
                            actions: chunk.actions,
                            chunks: [],
                            isFinished: false,
                            isNew: true,
                        };
                        for (const c of chunk.chunks) {
                            if (
                                nowTime + this.m3u8.getChunkLength() >= this.sliceStart &&
                                nowTime + this.m3u8.getChunkLength() < this.sliceEnd
                            ) {
                                // 添加已经在时间范围内的块
                                newChunkItem.chunks.push(c);
                                nowTime += this.m3u8.getChunkLength();
                            } else {
                                // 跳过时间范围外的块
                                nowTime += this.m3u8.getChunkLength();
                                continue;
                            }
                        }
                        newChunkList.push(newChunkItem);
                    }
                } else {
                    // 处理普通块
                    if (nowTime >= this.sliceStart) {
                        newChunkList.push(chunk);
                        nowTime += this.m3u8.getChunkLength();
                    } else {
                        nowTime += this.m3u8.getChunkLength();
                    }
                }
            }

            this.chunks = newChunkList;
        }

        this.allChunks = this.chunks.map((chunk) => {
            if (isChunkGroup(chunk)) {
                return {
                    ...chunk,
                    chunks: [...chunk.chunks],
                };
            } else {
                return chunk;
            }
        });

        this.totalChunksCount = 0;
        for (const chunk of this.chunks) {
            this.totalChunksCount += isChunkGroup(chunk) ? chunk.chunks.length : 1;
        }

        this.outputFileList = [];
        this.chunks.forEach((chunkItem) => {
            if (!isChunkGroup(chunkItem)) {
                if (chunkItem.isEncrypted) {
                    this.outputFileList.push(path.resolve(this.tempPath, `./${chunkItem.filename}.decrypt`));
                } else {
                    this.outputFileList.push(path.resolve(this.tempPath, `./${chunkItem.filename}`));
                }
            } else {
                for (const chunk of chunkItem.chunks) {
                    if (chunk.isEncrypted) {
                        this.outputFileList.push(path.resolve(this.tempPath, `./${chunk.filename}.decrypt`));
                    } else {
                        this.outputFileList.push(path.resolve(this.tempPath, `./${chunk.filename}`));
                    }
                }
            }
        });
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
        if (this.chunks.length > 0 && this.runningThreads < this.threads) {
            const task = this.chunks[0];
            let chunk: Chunk;
            if (isChunkGroup(task)) {
                if (task.actions && task.isNew) {
                    logger.debug(`Handle chunk actions for a new chunk group.`);
                    task.isNew = false;
                    for (const action of task.actions) {
                        await this.handleChunkGroupAction(action);
                    }
                    this.checkQueue();
                    return;
                }
                if (task.chunks.length > 0) {
                    chunk = task.chunks.shift();
                    chunk.parentGroup = task;
                    if (chunk.parentGroup.retryActions) {
                        for (const action of chunk.parentGroup.actions) {
                            await this.handleChunkGroupAction(action);
                        }
                        chunk.parentGroup.retryActions = false;
                    }
                } else {
                    // All chunks finished in group
                    logger.debug(`Skip a empty chunk group.`);
                    task.isFinished = true;
                    this.chunks.shift();
                    this.checkQueue();
                    return;
                }
            } else {
                chunk = this.chunks.shift() as Chunk;
                // this.chunks.shift();
            }
            this.pickedChunks.push(chunk);
            this.runningThreads++;
            this.handleTask(chunk)
                .then(() => {
                    this.runningThreads--;
                    const currentChunkInfo = {
                        taskname: chunk.filename,
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
                    this.finishedFilenames[chunk.filename] = true;
                    this.emit("chunk-downloaded", currentChunkInfo);
                    this.checkQueue();
                })
                .catch((e) => {
                    this.emit("chunk-error", e);
                    this.runningThreads--;
                    // 重试计数
                    if (chunk.retryCount) {
                        chunk.retryCount++;
                    } else {
                        chunk.retryCount = 1;
                    }
                    if (chunk.parentGroup) {
                        if (chunk.parentGroup.isFinished) {
                            // Add a new group to the queue.
                            this.chunks.push({
                                chunks: [chunk],
                                actions: chunk.parentGroup.actions,
                                isFinished: false,
                                isNew: true,
                            } as ChunkGroup);
                        } else {
                            chunk.parentGroup.retryActions = true;
                            chunk.parentGroup.chunks.push(chunk);
                        }
                    } else {
                        this.chunks.push(chunk);
                    }
                    this.checkQueue();
                });
            this.checkQueue();
        }
        if (
            this.chunks.length === 0 &&
            this.totalChunksCount === this.finishedChunkCount &&
            this.runningThreads === 0
        ) {
            if (this.isDownloaded) {
                return;
            }
            this.isDownloaded = true;
            logger.info("All chunks downloaded. Start merging chunks.");
            const muxer = this.format === "ts" ? mergeToTS : mergeToMKV;
            // Save before merge
            this.emit("downloaded");
            this.saveTask();
            if (this.noMerge) {
                logger.info("Skip merging. Please merge video chunks manually.");
                logger.info(`Temporary files are located at ${this.tempPath}`);
                this.emit("finished");
            }
            muxer(this.outputFileList, this.outputPath)
                .then(async () => {
                    logger.info("End of merging.");
                    logger.info("Starting cleaning temporary files.");
                    try {
                        await deleteDirectory(this.tempPath);
                    } catch (e) {
                        logger.warning(
                            `Fail to delete temporary files, please delete manually or execute "minyami --clean" later.`
                        );
                    }
                    try {
                        deleteTask(this.m3u8Path.split("?")[0]);
                    } catch (error) {
                        logger.warning("Fail to parse previous tasks, ignored.");
                        logger.warning(error.message);
                    }
                    logger.info(`All finished. Check your file at [${path.resolve(this.outputPath)}] .`);
                    this.emit("finished");
                })
                .catch(async (e) => {
                    await this.clean();
                    this.emit("merge-error", e);
                    logger.error("Fail to merge video. Please merge video chunks manually.", e);
                    logger.error(`Your temporary files at located at [${path.resolve(this.tempPath)}]`);
                });
        }
    }

    async resume(taskId: string) {
        const previousTask = getTask(taskId.split("?")[0]);
        if (!previousTask) {
            logger.error("Can't find a task to resume.");
            this.emit("critical-error");
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
        this.iv = previousTask.iv;
        this.verbose = previousTask.verbose;
        this.startedAt = new Date().valueOf();
        this.finishedChunkCount = 0;
        this.totalChunksCount = previousTask.totalChunksCount - previousTask.finishedChunksCount;
        this.retries = previousTask.retries;
        this.timeout = previousTask.timeout;
        this.proxy = previousTask.proxy;
        this.allChunks = previousTask.allChunks;
        this.chunks = previousTask.chunks;
        this.outputFileList = previousTask.outputFileList;
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
        await this.parse();

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
        const unfinishedChunks: ChunkItem[] = [];
        this.allChunks.forEach((chunkItem) => {
            if (isChunkGroup(chunkItem)) {
                let allFinishedFlag = true;
                const unfinishedChunksInItem: Chunk[] = [];
                for (const chunk of chunkItem.chunks) {
                    if (!this.finishedFilenames[chunk.filename]) {
                        allFinishedFlag = false;
                        unfinishedChunksInItem.push(chunk);
                    }
                }
                if (!allFinishedFlag) {
                    // 组中块未全部完成 加入未完成列表
                    unfinishedChunks.push({
                        ...chunkItem,
                        chunks: unfinishedChunksInItem,
                    });
                }
            } else {
                if (!this.finishedFilenames[chunkItem.filename]) {
                    unfinishedChunks.push(chunkItem);
                }
            }
        });

        let unfinishedChunksLength = 0;
        for (const chunk of unfinishedChunks) {
            unfinishedChunksLength += isChunkGroup(chunk) ? chunk.chunks.length : 1;
        }

        logger.info(`Downloaded: ${this.finishedChunkCount}; Waiting for download: ${unfinishedChunksLength}`);

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
                iv: this.iv,
                verbose: this.verbose,
                startedAt: this.startedAt,
                finishedChunksCount: this.totalChunksCount - unfinishedChunksLength,
                totalChunksCount: this.totalChunksCount,
                retries: this.retries,
                timeout: this.timeout,
                proxy: this.proxy,
                allChunks: this.allChunks,
                chunks: unfinishedChunks,
                outputFileList: this.outputFileList,
                finishedFilenames: this.finishedFilenames,
            });
        } catch (error) {
            logger.warning("Fail to parse previous tasks, ignored.");
            logger.warning(error.message);
        }
    }
}

export default ArchiveDownloader;
