import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { mergeToMKV, mergeToTS } from "../utils/media";
import { sleep } from "../utils/system";
import { loadM3U8 } from "../utils/m3u8";
import logger from "../utils/log";
import Downloader, { Chunk, LiveDownloaderConfig } from "./downloader";
import { EncryptedM3U8Chunk, M3U8Chunk, MasterPlaylist, Playlist } from "./m3u8";

/**
 * Live Downloader
 */

export default class LiveDownloader extends Downloader {
    outputFileList: string[] = [];
    finishedList: string[] = [];
    m3u8: Playlist;
    chunks: Chunk[] = [];
    runningThreads: number = 0;

    isEncrypted: boolean = false;
    isEnd: boolean = false;
    isStarted: boolean = false;
    forceStop: boolean = false;

    prefix: string;

    retries = 3;

    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(
        m3u8Path: string,
        { threads, output, key, verbose, retries, proxy, cookies, headers, nomerge, cliMode }: LiveDownloaderConfig
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
            cliMode,
        });
        if (retries) {
            this.retries = retries;
        }
    }

    async loadM3U8() {
        try {
            this.m3u8 = (await loadM3U8(this.m3u8Path, this.retries, this.timeout)) as Playlist;
        } catch (e) {
            if (this.finishedChunkCount > 0) {
                // Stop downloading
                this.isEnd = true;
            } else {
                logger.error("Aborted due to critical error.", e);
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
                    this.emit("finished");
                }
            });
        }

        try {
            // first time loading playlist
            const m3u8 = await loadM3U8(this.m3u8Path, this.retries, this.timeout);
            if (m3u8 instanceof MasterPlaylist) {
                const streams = m3u8.streams;
                const bestStream = streams.sort((a, b) => b.bandwidth - a.bandwidth)[0];
                logger.info("Master playlist input detected. Auto selecting best quality streams.");
                logger.debug(`Best stream: ${bestStream.url}; Bandwidth: ${bestStream.bandwidth}`);
                this.m3u8 = (await loadM3U8(bestStream.url, this.retries, this.timeout)) as Playlist;
                this.m3u8Path = bestStream.url;
            } else {
                this.m3u8 = m3u8;
            }
        } catch (e) {
            logger.error("Aborted due to critical error.", e);
            this.emit("critical-error", e);
        }

        this.chunkTimeout = Math.min(
            Math.max(20000, this.m3u8.chunks.length * this.m3u8.getChunkLength() * 1000),
            60000
        );

        if (this.m3u8.encryptKeys.length > 0) {
            this.isEncrypted = true;
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
                    this.emit("critical-error", e);
                }
            }
        } else {
            this.isEncrypted = false;
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
            }, 3000);
        }
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
            const currentPlaylistChunks: (M3U8Chunk | EncryptedM3U8Chunk)[] = [];
            this.m3u8.chunks.forEach((chunk) => {
                try {
                    // 去重
                    if (!this.finishedList.includes(this.onChunkNaming ? this.onChunkNaming(chunk) : chunk.url)) {
                        this.finishedList.push(this.onChunkNaming ? this.onChunkNaming(chunk) : chunk.url);
                        currentPlaylistChunks.push(chunk);
                    }
                } catch (e) {
                    // 无法正确命名块 忽略错误
                    // pass
                }
            });
            logger.debug(`Get ${currentPlaylistChunks.length} new chunk(s).`);
            const currentUndownloadedChunks = currentPlaylistChunks.map((chunk) => {
                const filename = this.onChunkNaming(chunk);
                return chunk.isEncrypted
                    ? {
                          filename,
                          isEncrypted: true,
                          key: chunk.key,
                          iv: chunk.iv,
                          sequenceId: chunk.sequenceId,
                          url: chunk.url,
                          length: chunk.length,
                      }
                    : {
                          filename,
                          isEncrypted: false,
                          sequenceId: chunk.sequenceId,
                          url: chunk.url,
                          length: chunk.length,
                      };
            });
            // 加入待完成的任务列表
            this.chunks.push(...currentUndownloadedChunks);
            this.outputFileList.push(
                ...currentUndownloadedChunks.map((chunk) => {
                    if (chunk.isEncrypted) {
                        return path.resolve(this.tempPath, `./${chunk.filename}.decrypt`);
                    } else {
                        return path.resolve(this.tempPath, `./${chunk.filename}`);
                    }
                })
            );

            await this.loadM3U8();

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
        if (this.chunks.length > 0 && this.runningThreads < this.threads) {
            const task = this.chunks.shift();
            this.runningThreads++;
            this.handleTask(task)
                .then(() => {
                    this.runningThreads--;
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
                    this.chunks.unshift(task); // 对直播流来说 早速重试比较好
                    this.checkQueue();
                });
            this.checkQueue();
        }
        if (this.chunks.length === 0 && this.runningThreads === 0 && this.isEnd) {
            // 结束状态 合并文件
            this.emit("downloaded");
            if (this.noMerge) {
                logger.info("Skip merging. Please merge video chunks manually.");
                logger.info(`Temporary files are located at ${this.tempPath}`);
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
                    logger.error(`Your temporary files at located at [${path.resolve(this.tempPath)}]`);
                    this.emit("critical-error", e);
                });
        }

        if (this.chunks.length === 0 && this.runningThreads === 0 && !this.isEnd) {
            // 空闲状态 一秒后再检查待完成任务列表
            logger.debug("Sleep 1000ms.");
            sleep(1000).then(() => {
                this.checkQueue();
            });
        }
    }
}
