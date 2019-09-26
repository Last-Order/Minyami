const path = require('path');
import Logger from '../utils/log';
import M3U8, { M3U8Chunk } from "./m3u8";
import { loadM3U8 } from '../utils/m3u8';
import * as system from '../utils/system';
import CommonUtils from '../utils/common';
import { download, decrypt } from '../utils/media';
import { ActionType } from './action';
import * as actions from './action';
import { AxiosRequestConfig } from 'axios';
import { EventEmitter } from 'events';

export interface DownloaderConfig {
    threads?: number;
    output?: string;
    key?: string;
    verbose?: boolean;
    cookies?: string;
    headers?: string;
    retries?: number;
    proxy?: string;
    format?: string;
}

export interface ArchiveDownloaderConfig extends DownloaderConfig {
    slice?: string;
}

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
    return !!((c as ChunkGroup).chunks);
}

class Downloader extends EventEmitter {
    Log: Logger;

    tempPath: string; // 临时文件目录
    m3u8Path: string; // m3u8文件路径
    m3u8: M3U8; // m3u8实体
    outputPath: string = './output.ts'; // 输出目录
    threads: number = 5; // 并发数量

    allChunks: ChunkItem[];
    chunks: ChunkItem[];
    pickedChunks: ChunkItem[];

    cookies: string; // Cookies
    headers: object = {}; // HTTP Headers
    key: string; // Key
    iv: string; // IV

    verbose: boolean = false; // 调试输出
    format: string = 'ts'; // 输出格式

    startedAt: number; // 开始下载时间
    finishedChunksCount: number = 0; // 已完成的块数量

    retries: number = 5; // 重试数量
    timeout: number = 60000; // 超时时间

    proxy: string = '';
    proxyHost: string = '';
    proxyPort: number = 0;

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
    constructor(log: Logger, m3u8Path: string, { threads, output, key, verbose, retries, proxy, format, cookies, headers }: DownloaderConfig = {
        threads: 5
    }) {
        super();
        this.Log = log;

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
            for (const h of headers.split('\n')) {
                const header = h.split(':');
                if (header.length !== 2) {
                    this.Log.error(`HTTP Headers invalid.`);
                }
                this.headers[header[0]] = header[1];
            }
        }

        if (proxy) {
            const splitedProxyString: string[] = proxy.split(':');
            this.proxy = proxy;
            this.proxyHost = splitedProxyString.slice(0, splitedProxyString.length - 1).join('');
            this.proxyPort = parseInt(splitedProxyString[splitedProxyString.length - 1]);
        }

        this.m3u8Path = m3u8Path;

        if (this.format === 'ts' && this.outputPath.endsWith('.mkv')) {
            this.Log.warning(`Output file name ends with .mkv is not supported in direct muxing mode, auto changing to .ts.`);
            this.outputPath = this.outputPath + '.ts';
        }

        if (process.platform === "win32") {
            var rl = require("readline").createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.on("SIGINT", function () {
                // @ts-ignore
                process.emit("SIGINT");
            });
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
            const options: AxiosRequestConfig = {};
            if (this.cookies) {
                options.headers = {
                    'Cookie': this.cookies
                }
            }
            if (Object.keys(this.headers).length > 0) {
                options.headers = this.headers;
            }
            this.m3u8 = await loadM3U8(
                this.Log,
                this.m3u8Path,
                this.retries,
                this.timeout,
                this.proxy ? { host: this.proxyHost, port: this.proxyPort } : undefined,
                options
            );
        } catch (e) {
            this.Log.error('Aborted due to critical error.', e);
        }
    }

    /**
     * 退出前的清理工作
     */
    async clean() {
        try {
            this.Log.info('Starting cleaning temporary files.');
            await system.deleteDirectory(this.tempPath);
        } catch (e) {
            this.Log.error('Fail to delete temporary directory.');
        }
    }

    /**
     * 处理块下载任务
     * @param task 块下载任务
     */
    handleTask(task: Chunk) {
        this.verbose && this.Log.debug(`Downloading ${task.url}`);
        const options: AxiosRequestConfig = {};
        if (this.cookies) {
            options.headers = {
                'Cookie': this.cookies
            }
        }
        if (Object.keys(this.headers).length > 0) {
            options.headers = this.headers;
        }
        options.timeout = Math.min(((task.retryCount || 0) + 1) * this.timeout, this.timeout * 5);
        return new Promise(async (resolve, reject) => {
            this.verbose && this.Log.debug(`Downloading ${task.filename}`);
            try {
                await download(
                    task.url,
                    path.resolve(this.tempPath, `./${task.filename}`),
                    this.proxy ? { host: this.proxyHost, port: this.proxyPort } : undefined,
                    options
                );
                this.verbose && this.Log.debug(`Downloading ${task.filename} succeed.`);
                if (this.m3u8.isEncrypted) {
                    if (task.key) {
                        if (task.iv) {
                            await decrypt(
                                path.resolve(this.tempPath, `./${task.filename}`),
                                path.resolve(this.tempPath, `./${task.filename}`) + '.decrypt',
                                this.getEncryptionKey(CommonUtils.buildFullUrl(
                                    this.m3u8.m3u8Url, task.key
                                )),
                                task.iv
                            );
                        } else {
                            await decrypt(
                                path.resolve(this.tempPath, `./${task.filename}`),
                                path.resolve(this.tempPath, `./${task.filename}`) + '.decrypt',
                                this.getEncryptionKey(CommonUtils.buildFullUrl(
                                    this.m3u8.m3u8Url, task.key
                                )),
                                task.sequenceId || this.m3u8.sequenceId
                            );
                        }
                    } else {
                        if (task.iv) {
                            await decrypt(
                                path.resolve(this.tempPath, `./${task.filename}`),
                                path.resolve(this.tempPath, `./${task.filename}`) + '.decrypt',
                                this.getEncryptionKey(CommonUtils.buildFullUrl(
                                    this.m3u8.m3u8Url, this.m3u8.key
                                )),
                                this.m3u8.iv
                            );
                        } else {
                            await decrypt(
                                path.resolve(this.tempPath, `./${task.filename}`),
                                path.resolve(this.tempPath, `./${task.filename}`) + '.decrypt',
                                this.getEncryptionKey(CommonUtils.buildFullUrl(
                                    this.m3u8.m3u8Url, this.m3u8.key
                                )),
                                task.sequenceId || this.m3u8.sequenceId
                            );
                        }
                        this.verbose && this.Log.debug(`Decrypting ${task.filename} succeed`);
                    }
                }
                resolve();
            } catch (e) {
                this.Log.warning(`Downloading or decrypting ${task.filename} failed. Retry later. [${e.code || 
                    (e.response ? `${e.response.status} ${e.response.statusText}` : undefined)
                || e.message || e.constructor.name || 'UNKNOWN'}]`);
                this.verbose && this.Log.debug(e);
                reject(e);
            }
        });
    }

    async handleChunkGroupAction(action: ChunkAction) {
        try {
            switch (action.actionName) {
                case 'ping': {
                    await actions.ping(action.actionParams);
                }
                case 'sleep': {
                    await actions.sleep(action.actionParams);
                }
            }
            this.Log.info(`Chunk group action <${action.actionName}> finished.`);
        } catch (e) {
            this.Log.info(`Chunk group action <${action.actionName}> failed.`);
            this.Log.info(e);
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
        return (this.finishedChunksCount * this.m3u8.getChunkLength() / Math.round((new Date().valueOf() - this.startedAt) / 1000)).toFixed(2);
    }
};

export default Downloader;