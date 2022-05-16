import * as path from "path";
import * as fs from "fs";
import { URL } from "url";
import axios, { AxiosRequestConfig } from "axios";
import { EventEmitter } from "events";
import logger from "../utils/log";
import { loadM3U8 } from "../utils/m3u8";
import * as system from "../utils/system";
import CommonUtils from "../utils/common";
import { download, decrypt } from "../utils/media";
import ProxyAgentHelper from "../utils/agent";
import UA from "../constants/ua";
import { EncryptedM3U8Chunk, M3U8Chunk, MasterPlaylist, Playlist } from "./m3u8";
import type { ActionType } from "./action";
import * as actions from "./action";

export interface DownloaderConfig {
    threads?: number;
    output?: string;
    key?: string;
    verbose?: boolean;
    cookies?: string;
    headers?: string | string[];
    retries?: number;
    proxy?: string;
    format?: string;
    nomerge?: boolean;
    keepEncryptedChunks?: boolean;
    cliMode?: boolean;
}

export interface ArchiveDownloaderConfig extends DownloaderConfig {
    slice?: string;
}

export interface LiveDownloaderConfig extends DownloaderConfig {}

export interface Chunk {
    url: string;
    filename: string;
    isEncrypted: boolean;
    parentGroup?: ChunkGroup;
    key?: string;
    iv?: string;
    length: number;
    sequenceId?: number;
    retryCount?: number;
    isInitialChunk?: boolean;
}

export interface ChunkAction {
    actionName: ActionType;
    actionParams: string;
}

export interface ChunkGroup {
    chunks: Chunk[];
    actions?: ChunkAction[];
    isFinished: boolean;
    isNew: boolean;
    retryActions?: boolean;
}

export type ChunkItem = Chunk | ChunkGroup;

export interface OnKeyUpdatedParams {
    keyUrls: string[];
    m3u8Url: string;
    explicitKeys: string[];
    saveEncryptionKey: (url: string, key: string) => void;
}

export function isChunkGroup(c: ChunkItem): c is ChunkGroup {
    return !!(c as ChunkGroup).chunks;
}

class Downloader extends EventEmitter {
    cliMode: boolean = false;

    /** 临时文件目录 */
    tempPath: string;
    /** m3u8文件路径 */
    m3u8Path: string;
    /** M3U8 Playlist */
    m3u8: Playlist;
    /** 输出目录 */
    outputPath: string = "./output.ts";
    /** 输出文件列表 */
    outputFileList: string[];
    /** 并发数量 */
    threads: number = 5;

    allChunks: ChunkItem[];
    chunks: ChunkItem[];
    pickedChunks: ChunkItem[];

    /** Cookies */
    cookies: string;
    /** HTTP Headers */
    headers: Record<string, string> = {};
    key: string;

    /** 是否打印调试信息 */
    verbose: boolean = false;
    /** 输出格式 */
    format: string = "ts";
    noMerge: boolean = false;

    /** 开始下载时间 */
    startedAt: number;
    /** 块总长度 */
    totalChunkLength: number = 0;
    /** 已完成的块数量 */
    finishedChunkCount: number = 0;
    /** 已完成的块总长度 */
    finishedChunkLength: number = 0;

    /** 重试数量 */
    retries: number = 5;

    /** 超时时间 */
    timeout: number = 60000;

    /** 块超时时间 */
    chunkTimeout: number = 60000;

    proxy: string = "";

    autoGenerateChunkList: boolean = true;

    encryptionKeys = {};

    keepEncryptedChunks = false;

    // Hooks
    protected onChunkNaming: (chunk: M3U8Chunk | EncryptedM3U8Chunk) => string = (chunk) => {
        return new URL(chunk.url).pathname
            .split("/")
            .slice(-1)[0]
            .slice(8 - 255);
    };

    protected async onKeyUpdated({ keyUrls, explicitKeys, saveEncryptionKey }: OnKeyUpdatedParams) {}

    constructor(
        m3u8Path: string,
        {
            threads,
            output,
            key,
            verbose,
            retries,
            proxy,
            format,
            cookies,
            headers,
            nomerge,
            cliMode = false,
            keepEncryptedChunks,
        }: DownloaderConfig = {
            threads: 5,
        }
    ) {
        super();

        if (threads) {
            this.threads = threads;
        }

        if (output) {
            this.outputPath = output;
        }

        if (key) {
            this.key = key;
        }

        if (verbose) {
            this.verbose = verbose;
        }

        if (retries) {
            this.retries = retries;
        }

        if (format) {
            this.format = format;
        }

        if (cookies) {
            this.cookies = cookies;
        }

        if (headers) {
            const headerConfigArr = Array.isArray(headers) ? headers : [headers];
            for (const headerConfig of headerConfigArr) {
                for (const h of headerConfig.split("\\n")) {
                    try {
                        const header = /^([^ :]+):(.+)$/.exec(h).slice(1);
                        this.headers[header[0]] = header[1].trim();
                    } catch (e) {
                        logger.warning(`HTTP Headers invalid. Ignored.`);
                    }
                }
            }
            // Apply global custom headers
            axios.defaults.headers.common = {
                ...axios.defaults.headers.common,
                ...{
                    "User-Agent": UA.CHROME_DEFAULT_UA,
                },
                ...(this.cookies ? { Cookie: this.cookies } : {}), // Cookies 优先级低于 Custom Headers
                ...this.headers,
            };
        }

        if (proxy) {
            this.proxy = proxy;
            ProxyAgentHelper.setProxy(proxy, {
                allowNonPrefixSocksProxy: true,
            });
        }

        if (nomerge) {
            this.noMerge = nomerge;
            logger.info("Temporary files will not be deleted automatically.");
        }

        if (keepEncryptedChunks) {
            this.keepEncryptedChunks = keepEncryptedChunks;
            logger.info("Encrypted chunks will not be deleted automatically.");
            if (!this.noMerge) {
                logger.warning(`--keep-encrypted-chunks should be used with --keep.`);
            }
        }

        this.m3u8Path = m3u8Path;

        if (this.format === "ts" && this.outputPath.endsWith(".mkv")) {
            logger.warning(
                `Output file name ends with .mkv is not supported in direct muxing mode, auto changing to .ts.`
            );
            this.outputPath = this.outputPath + ".ts";
        }

        this.cliMode = cliMode;

        if (cliMode) {
            if (process.platform === "win32") {
                var rl = require("readline").createInterface({
                    input: process.stdin,
                    output: process.stdout,
                });

                rl.on("SIGINT", function () {
                    // @ts-ignore
                    process.emit("SIGINT");
                });
            }
        }
    }

    /**
     * 初始化 读取m3u8内容
     */
    async init() {
        await this.loadM3U8();
    }

    async loadM3U8() {
        try {
            const m3u8 = await loadM3U8(this.m3u8Path, this.retries, this.timeout);
            if (m3u8 instanceof MasterPlaylist) {
                const streams = m3u8.streams;
                const bestStream = streams.sort((a, b) => b.bandwidth - a.bandwidth)[0];
                logger.info("Master playlist input detected. Auto selecting best quality streams.");
                logger.debug(`Best stream: ${bestStream.url}; Bandwidth: ${bestStream.bandwidth}`);
                this.m3u8 = (await loadM3U8(bestStream.url, this.retries, this.timeout)) as Playlist;
            } else {
                this.m3u8 = m3u8;
            }
            this.totalChunkLength = this.m3u8.chunks.reduce(
                (prevLength, currentChunk) => prevLength + currentChunk.length,
                0
            );
        } catch (e) {
            logger.error("Aborted due to critical error.", e);
            this.emit("critical-error", e);
        }
    }

    async checkKeys() {
        if (this.m3u8.encryptKeys.length > 0) {
            const newKeys = this.m3u8.encryptKeys.filter(
                (key) => !this.getEncryptionKey(CommonUtils.buildFullUrl(this.m3u8.m3u8Url, key))
            );
            if (newKeys.length > 0) {
                await this.onKeyUpdated({
                    keyUrls: newKeys,
                    explicitKeys: this.key ? this.key.split(",") : [],
                    m3u8Url: this.m3u8.m3u8Url,
                    saveEncryptionKey: this.saveEncryptionKey.bind(this),
                });
            }
        }
    }

    /**
     * 退出前的清理工作
     */
    async clean() {
        try {
            logger.info("Starting cleaning temporary files.");
            await system.deleteDirectory(this.tempPath, this.outputFileList);
        } catch (e) {
            logger.warning(
                `Fail to delete temporary files, please delete manually or execute "minyami --clean" later.`
            );
        }
    }

    /**
     * 处理块下载任务
     * @param task 块下载任务
     */
    handleTask(task: Chunk) {
        logger.debug(`Downloading ${task.url}`);
        const options: AxiosRequestConfig = {};
        options.timeout = Math.min(((task.retryCount || 0) + 1) * this.chunkTimeout, this.chunkTimeout * 5);
        return new Promise<void>(async (resolve, reject) => {
            logger.debug(`Downloading ${task.filename}`);
            try {
                await download(task.url, path.resolve(this.tempPath, `./${task.filename}`), options);
                logger.debug(`Downloading ${task.filename} succeed.`);
                if (task.isEncrypted) {
                    await decrypt(
                        path.resolve(this.tempPath, `./${task.filename}`),
                        path.resolve(this.tempPath, `./${task.filename}`) + ".decrypt",
                        this.getEncryptionKey(CommonUtils.buildFullUrl(this.m3u8.m3u8Url, task.key)),
                        task.iv || task.sequenceId.toString(16),
                        this.keepEncryptedChunks
                    );
                    logger.debug(`Decrypting ${task.filename} succeed`);
                }
                this.finishedChunkCount++;
                this.finishedChunkLength += task.length;
                resolve();
            } catch (e) {
                logger.warning(
                    `Downloading or decrypting ${task.filename} failed. Retry later. [${
                        e.code ||
                        (e.response ? `${e.response.status} ${e.response.statusText}` : undefined) ||
                        e.message ||
                        e.constructor.name ||
                        "UNKNOWN"
                    }]`
                );
                logger.debug(e);
                reject(e);
            }
        });
    }

    async handleChunkGroupAction(action: ChunkAction) {
        try {
            switch (action.actionName) {
                case "ping": {
                    await actions.ping(action.actionParams);
                }
                case "sleep": {
                    await actions.sleep(action.actionParams);
                }
            }
            logger.info(`Chunk group action <${action.actionName}> finished.`);
        } catch (e) {
            logger.info(`Chunk group action <${action.actionName}> failed.`);
            logger.info(e);
        }
    }

    /**
     * ======================
     * Some hooks for parsers
     * ======================
     */

    saveEncryptionKey(url: string, key: string) {
        this.encryptionKeys[url] = key;
    }

    getEncryptionKey(url: string) {
        return this.encryptionKeys[url];
    }

    setOnChunkNaming(handler: (chunk: M3U8Chunk | EncryptedM3U8Chunk) => string) {
        this.onChunkNaming = handler;
    }

    setOnKeyUpdated(handler: (params: OnKeyUpdatedParams) => Promise<void>) {
        this.onKeyUpdated = handler;
    }

    /**
     * 计算以块计算的下载速度
     */
    calculateSpeedByChunk() {
        return (this.finishedChunkCount / Math.round((new Date().valueOf() - this.startedAt) / 1000)).toFixed(2);
    }

    /**
     * 计算以视频长度为基准下载速度倍率
     */
    calculateSpeedByRatio() {
        return (this.finishedChunkLength / Math.round((new Date().valueOf() - this.startedAt) / 1000)).toFixed(2);
    }
}

export default Downloader;
