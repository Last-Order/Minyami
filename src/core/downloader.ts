const path = require('path');
const fs = require('fs');
import Logger from '../utils/log';
let Log = Logger.getInstance();
import M3U8 from "./m3u8";
import { loadM3U8 } from '../utils/m3u8';
import * as system from '../utils/system';
import { download, decrypt } from '../utils/media';

export interface DownloaderConfig {
    threads?: number;
    output?: string;
    key?: string;
    verbose?: boolean;
    nomux?: boolean;
    retries?: number;
    proxy?: string;
}

export interface ArchiveDownloaderConfig extends DownloaderConfig {
    slice?: string;
}

export interface Chunk {
    url: string;
    filename: string;
}

class Downloader {
    tempPath: string; // 临时文件目录
    m3u8Path: string; // m3u8文件路径
    m3u8: M3U8; // m3u8实体
    outputPath: string = './output.mkv'; // 输出目录
    threads: number = 5; // 并发数量

    allChunks: Chunk[];
    chunks: Chunk[];
    pickedChunks: Chunk[];

    key: string; // Key
    iv: string; // IV

    verbose: boolean = false; // 调试输出
    nomux: boolean = false; // 仅合并分段不remux

    startedAt: number; // 开始下载时间
    finishedChunksCount: number = 0; // 已完成的块数量

    retries: number = 1; // 重试数量
    timeout: number = 60000; // 超时时间

    proxy: string = '';
    proxyHost: string = '';
    proxyPort: number = 0;

    /**
     * 
     * @param m3u8Path 
     * @param config
     * @param config.threads 线程数量 
     */
    constructor(m3u8Path: string, { threads, output, key, verbose, nomux, retries, proxy }: DownloaderConfig = {
        threads: 5
    }) {
        if (threads) {
            this.threads = threads;
        }

        if (nomux) {
            this.nomux = nomux;
            this.outputPath = 'output.ts';
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

        if (proxy) {
            const splitedProxyString: string[] = proxy.split(':');
            this.proxy = proxy;
            this.proxyHost = splitedProxyString.slice(0, splitedProxyString.length - 1).join('');
            this.proxyPort = parseInt(splitedProxyString[splitedProxyString.length - 1]);
        }

        this.m3u8Path = m3u8Path;

        if (process.platform === "win32") {
            var rl = require("readline").createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.on("SIGINT", function () {
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
            this.m3u8 = await loadM3U8(
                this.m3u8Path, 
                this.retries, 
                this.timeout, 
                this.proxy ? { host: this.proxyHost, port: this.proxyPort } : undefined
            );
        } catch (e) {
            // console.log(e);
            await this.clean();
            Log.error('Aborted due to critical error.', e);
        }
    }

    /**
     * 退出前的清理工作
     */
    async clean() {
        try {
            Log.info('Starting cleaning temporary files.');
            await system.deleteDirectory(this.tempPath);
        } catch (e) {
            Log.error('Fail to delete temporary directory.');
        }
    }

    /**
     * 处理块下载任务
     * @param task 块下载任务
     */
    handleTask(task: Chunk) {
        return new Promise(async (resolve, reject) => {
            this.verbose && Log.debug(`Downloading ${task.filename}`);
            try {
                await download(
                    task.url, 
                    path.resolve(this.tempPath, `./${task.filename}`),
                    this.proxy ? { host: this.proxyHost, port: this.proxyPort } : undefined
                );
                this.verbose && Log.debug(`Downloading ${task.filename} succeed.`);
                if (this.m3u8.isEncrypted) {
                    await decrypt(path.resolve(this.tempPath, `./${task.filename}`), path.resolve(this.tempPath, `./${task.filename}`) + '.decrypt', this.key, this.iv);
                    this.verbose && Log.debug(`Decrypting ${task.filename} succeed`);
                }
                resolve();
            } catch (e) {
                Log.warning(`Downloading or decrypting ${task.filename} failed. Retry later.`);
                reject(e);
            }            
        });
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