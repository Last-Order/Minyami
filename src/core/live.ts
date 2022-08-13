import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { mergeToMKV, mergeToTS } from "../utils/media";
import { sleep } from "../utils/system";
import { loadM3U8 } from "../utils/m3u8";
import logger from "../utils/log";
import Downloader, { DownloadTask, LiveDownloaderConfig } from "./downloader";
import { isEncryptedChunk, M3U8Chunk, MasterPlaylist, Playlist } from "./m3u8";
import { getFileExt } from "../utils/common";
import FileConcentrator, { TaskStatus } from "./file_concentrator";

/**
 * Live Downloader
 */

export default class LiveDownloader extends Downloader {
    outputFileList: string[] = [];
    finishedList: number[] = [];
    m3u8: Playlist;
    downloadTasks: DownloadTask[] = [];
    runningThreads: number = 0;
    totalCount: number = 0;

    isEnd: boolean = false;
    isStarted: boolean = false;
    forceStop: boolean = false;

    prefix: string;

    retries = 5;

    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(
        m3u8Path: string,
        {
            threads,
            output,
            key,
            verbose,
            retries,
            proxy,
            cookies,
            headers,
            nomerge,
            keepEncryptedChunks,
            cliMode,
        }: LiveDownloaderConfig
    ) {
        super(m3u8Path, {
            threads: threads || 5,
            output,
            key,
            verbose,
            retries,
            proxy,
            cookies,
            headers,
            nomerge,
            keepEncryptedChunks,
            cliMode,
        });
        if (retries) {
            this.retries = retries;
        }
    }

    async refreshM3U8() {
        try {
            this.m3u8 = (await loadM3U8({
                path: this.m3u8Path,
                retries: this.retries,
                timeout: this.timeout,
                initPrimaryKey: this.totalCount,
            })) as Playlist;
        } catch (e) {
            if (this.finishedChunkCount > 0) {
                const responseStatus = e?.response?.status;
                if (!!responseStatus && responseStatus >= 400 && responseStatus <= 599) {
                    logger.info("M3U8 file is no longer available. Stop downloading.");
                    // Stop downloading
                    this.isEnd = true;
                }
            } else {
                logger.error("Aborted due to critical error.", e);
                logger.info(`Your temporary files are located at [${path.resolve(this.tempPath)}]`);
                this.saveTask();
                this.emit("critical-error", e);
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
                if (!this.forceStop) {
                    logger.info("Ctrl+C pressed, waiting for tasks finished.");
                    this.isEnd = true;
                    this.forceStop = true;
                } else {
                    logger.info("Force stop."); // TODO: reject all download promises
                    logger.info(`Your temporary files are located at [${path.resolve(this.tempPath)}]`);
                    this.saveTask();
                    this.emit("finished");
                }
            });
        }

        await this.loadM3U8();

        this.chunkTimeout = Math.min(
            Math.max(20000, this.m3u8.chunks.length * this.m3u8.getChunkLength() * 1000),
            60000
        );

        if (this.m3u8.encryptKeys.length > 0) {
            const key = this.m3u8.encryptKeys[0];
            if (key.startsWith("abematv-license")) {
                logger.info("Site comfirmed: AbemaTV");
                const parser = await import("./parsers/abema");
                parser.default.parse({
                    downloader: this,
                });
            } else if (this.m3u8Path.includes("hls-auth.cloud.stream.co.jp")) {
                logger.info("Site comfirmed: Nicochannel.");
                const nicoChannelParser = await import("./parsers/nicochannel");
                nicoChannelParser.default.parse({
                    downloader: this,
                });
                const commonParser = await import("./parsers/common");
                await commonParser.default.parse({
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
                    logger.info(`Your temporary files are located at [${path.resolve(this.tempPath)}]`);
                    this.saveTask();
                    this.emit("critical-error", e);
                }
            }
        } else {
            // Not encrypted
            if (this.m3u8Path.includes("dmc.nico")) {
                logger.info("Site comfirmed: Niconico.");
                const parser = await import("./parsers/nicolive");
                parser.default.parse({
                    downloader: this,
                });
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
                    logger.info(`Your temporary files are located at [${path.resolve(this.tempPath)}]`);
                    this.saveTask();
                    this.emit("critical-error", e);
                }
            }
        }
        this.emit("parsed");
        if (this.verbose) {
            setInterval(() => {
                logger.debug(
                    `Now running threads: ${this.runningThreads}, finished chunks: ${this.finishedChunkCount}`
                );
                this.saveTask();
            }, 3000);
        }
        await this.checkKeys();
        await this.cycling();
    }

    async cycling() {
        while (true) {
            if (this.isEnd) {
                // 结束下载 进入合并流程
                break;
            }
            if (this.m3u8.isEnd) {
                // 到达直播末尾
                logger.info("Stream ended. Waiting for current tasks finished.");
                this.isEnd = true;
            }
            const currentPlaylistChunks: M3U8Chunk[] = [];
            this.m3u8.chunks.forEach((chunk) => {
                try {
                    // 去重
                    if (!this.finishedList.includes(chunk.primaryKey)) {
                        this.finishedList.push(chunk.primaryKey);
                        currentPlaylistChunks.push(chunk);
                    }
                } catch (e) {
                    // 无法正确命名块 忽略错误
                    // pass
                }
            });
            logger.debug(`Get ${currentPlaylistChunks.length} new chunk(s).`);
            const newTasks = currentPlaylistChunks.map((chunk) => {
                const filename = this.onChunkNaming(chunk);
                return {
                    filename,
                    url: chunk.url,
                    retryCount: 0,
                    chunk,
                };
            });
            // 加入待完成的任务列表
            this.downloadTasks.push(...newTasks);

            this.outputFileList.push(
                ...newTasks.map((task) => {
                    if (isEncryptedChunk(task.chunk)) {
                        return path.resolve(this.tempPath, `./${task.filename}.decrypt`);
                    } else {
                        return path.resolve(this.tempPath, `./${task.filename}`);
                    }
                })
            );

            this.totalCount += newTasks.length;

            await this.refreshM3U8();
            await this.checkKeys();

            if (!this.isStarted) {
                this.isStarted = true;
                this.checkQueue();
            }
            logger.debug(`Cool down... Wait for next check`);
            await sleep(Math.min(5000, this.m3u8.getChunkLength() * 1000));
        }
    }

    /**
     * Stop downloading for external use
     */
    stopDownload() {
        this.isEnd = true;
    }

    checkQueue() {
        if (this.downloadTasks.length > 0 && this.runningThreads < this.threads) {
            const task = this.downloadTasks.shift();
            this.runningThreads++;
            this.handleTask(task)
                .then(() => {
                    this.runningThreads--;

                    this.fileConcentrator.addTasks([
                        {
                            filePath: isEncryptedChunk(task.chunk)
                                ? path.resolve(this.tempPath, `./${task.filename}.decrypt`)
                                : path.resolve(this.tempPath, `./${task.filename}`),
                            index: task.chunk.primaryKey,
                        },
                    ]);

                    const currentChunkInfo = {
                        taskname: task.filename,
                        finishedChunksCount: this.finishedChunkCount,
                        chunkSpeed: this.calculateSpeedByChunk(),
                        ratioSpeed: this.calculateSpeedByRatio(),
                    };

                    logger.info(
                        `Processing ${currentChunkInfo.taskname} finished. (${currentChunkInfo.finishedChunksCount} chunks downloaded | Avg Speed: ${currentChunkInfo.chunkSpeed} chunks/s or ${currentChunkInfo.ratioSpeed}x)`
                    );
                    this.emit("chunk-downloaded", currentChunkInfo);
                    this.checkQueue();
                })
                .catch((e) => {
                    this.emit("chunk-error", e, task.filename);
                    // 重试计数
                    if (task.retryCount) {
                        task.retryCount++;
                    } else {
                        task.retryCount = 1;
                    }
                    logger.warning(`Processing ${task.filename} failed.`);
                    logger.debug(e.message);
                    this.runningThreads--;
                    this.downloadTasks.unshift(task); // 对直播流来说 早速重试比较好
                    this.checkQueue();
                });
            this.checkQueue();
        }
        if (this.downloadTasks.length === 0 && this.runningThreads === 0 && this.isEnd) {
            // 结束状态 合并文件
            this.emit("downloaded");
            if (this.noMerge) {
                logger.info("Skip merging. Please merge video chunks manually.");
                logger.info(`Temporary files are located at ${this.tempPath}`);
                this.saveTask();
                this.emit("finished");
            }
            logger.info(`${this.finishedChunkCount} chunks downloaded. Start merging chunks.`);
            const muxer = this.format === "ts" ? mergeToTS : mergeToMKV;
            muxer(this.outputFileList, this.outputPath)
                .then(async (outputPath) => {
                    logger.info("End of merging.");
                    await this.clean();
                    logger.info(`All finished. Check your file at [${path.resolve(outputPath)}] .`);
                    this.emit("finished");
                })
                .catch((e) => {
                    logger.error("Fail to merge video. Please merge video chunks manually.", e);
                    logger.info(`Your temporary files are located at [${path.resolve(this.tempPath)}]`);
                    this.saveTask();
                    this.emit("critical-error", e);
                });
        }

        if (this.downloadTasks.length === 0 && this.runningThreads === 0 && !this.isEnd) {
            // 空闲状态 一秒后再检查待完成任务列表
            logger.debug("Sleep 1000ms.");
            sleep(1000).then(() => {
                this.checkQueue();
            });
        }
    }

    saveTask() {
        const taskInfo = {
            tempPath: this.tempPath,
            m3u8Path: this.m3u8Path,
            outputPath: this.outputPath,
            threads: this.threads,
            cookies: this.cookies,
            headers: this.headers,
            key: this.key,
            verbose: this.verbose,
            startedAt: this.startedAt,
            retries: this.retries,
            timeout: this.timeout,
            proxy: this.proxy,
            outputFileList: this.outputFileList,
        };
        const savePath = path.resolve(this.tempPath, "./task.json");
        try {
            fs.writeFileSync(savePath, JSON.stringify(taskInfo, null, 2));
        } catch (e) {
            logger.warning("Fail to save task info.");
            logger.debug(e);
        }
    }
}
