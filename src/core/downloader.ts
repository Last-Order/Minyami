import * as path from "path";
import * as fs from "fs";
import axios, { AxiosRequestConfig } from "axios";
import { EventEmitter } from "events";
import logger from "../utils/log";
import M3U8, { M3U8Chunk } from "./m3u8";
import { loadM3U8 } from "../utils/m3u8";
import * as system from "../utils/system";
import CommonUtils from "../utils/common";
import { download, decrypt } from "../utils/media";
import ProxyAgentHelper from "../utils/agent";
import UA from "../constants/ua";
import { ActionType } from "./action";
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
    cliMode?: boolean;
}

export interface ArchiveDownloaderConfig extends DownloaderConfig {
    slice?: string;
}

export interface LiveDownloaderConfig extends DownloaderConfig {}

export interface Chunk {
    url: string;
    filename: string;
    isEncrypted?: boolean;
    parentGroup?: ChunkGroup;
    key?: string;
    iv?: string;
    sequenceId?: string;
    retryCount?: number;
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

export function isChunkGroup(c: ChunkItem): c is ChunkGroup {
    return !!(c as ChunkGroup).chunks;
}

class Downloader extends EventEmitter {
    cliMode: boolean = false;

    tempPath: string; // 临时文件目录
    m3u8Path: string; // m3u8文件路径
    m3u8: M3U8; // m3u8实体
    outputPath: string = "./output.ts"; // 输出目录
    threads: number = 5; // 并发数量

    allChunks: ChunkItem[];
    chunks: ChunkItem[];
    pickedChunks: ChunkItem[];

    cookies: string; // Cookies
    headers: object = {}; // HTTP Headers
    key: string; // Key
    iv: string; // IV

    verbose: boolean = false; // 调试输出
    format: string = "ts"; // 输出格式
    noMerge: boolean = false;

    startedAt: number; // 开始下载时间
    finishedChunksCount: number = 0; // 已完成的块数量

    retries: number = 5; // 重试数量
    timeout: number = 60000; // 超时时间

    proxy: string = "";

    autoGenerateChunkList: boolean = true;

    encryptionKeys = {};

    // Hooks
    onChunkNaming: (chunk: M3U8Chunk) => string;
    onDownloadError: (error: Error, downloader: Downloader) => void;

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
            format,
            cookies,
            headers,
            nomerge,
            cliMode = false,
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
            if (fs.existsSync(this.outputPath)) {
                // output filename conflict
                const pathArr = this.outputPath.split(".");
                const filePath = pathArr.slice(0, -1).join(".");
                const ext = pathArr[pathArr.length - 1];
                this.outputPath = `${filePath}_${Date.now()}.${ext}`;
            }
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
            this.m3u8 = await loadM3U8(this.m3u8Path, this.retries, this.timeout);
        } catch (e) {
            logger.error("Aborted due to critical error.", e);
            this.emit("critical-error");
        }
    }

    /**
     * 退出前的清理工作
     */
    async clean() {
        try {
            logger.info("Starting cleaning temporary files.");
            await system.deleteDirectory(this.tempPath);
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
        options.timeout = Math.min(((task.retryCount || 0) + 1) * this.timeout, this.timeout * 5);
        return new Promise<void>(async (resolve, reject) => {
            logger.debug(`Downloading ${task.filename}`);
            try {
                await download(task.url, path.resolve(this.tempPath, `./${task.filename}`), options);
                logger.debug(`Downloading ${task.filename} succeed.`);
                if (this.m3u8.isEncrypted) {
                    await decrypt(
                        path.resolve(this.tempPath, `./${task.filename}`),
                        path.resolve(this.tempPath, `./${task.filename}`) + ".decrypt",
                        this.getEncryptionKey(CommonUtils.buildFullUrl(this.m3u8.m3u8Url, task.key || this.m3u8.key)),
                        task.iv || this.m3u8.iv || task.sequenceId || this.m3u8.sequenceId
                    );
                    logger.debug(`Decrypting ${task.filename} succeed`);
                }
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

    saveEncryptionKey(url: string, key: string) {
        this.encryptionKeys[url] = key;
    }

    getEncryptionKey(url: string) {
        return this.encryptionKeys[url];
    }

    /**
     * 计算以块计算的下载速度
     */
    calculateSpeedByChunk() {
        return (this.finishedChunksCount / Math.round((new Date().valueOf() - this.startedAt) / 1000)).toFixed(2);
    }

    /**
     * 计算以视频长度为基准下载速度倍率
     */
    calculateSpeedByRatio() {
        return (
            (this.finishedChunksCount * this.m3u8.getChunkLength()) /
            Math.round((new Date().valueOf() - this.startedAt) / 1000)
        ).toFixed(2);
    }
}

export default Downloader;
