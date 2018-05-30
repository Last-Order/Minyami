import Downloader, { DownloaderConfig } from "./downloader";
import M3U8 from "./m3u8";
import { loadM3U8 } from "../utils/m3u8";
import Log from "../utils/log";
import { download, decrypt, mergeVideo } from "../utils/media";
import { exec, sleep } from "../utils/system";
const path = require('path');
const fs = require('fs');

export interface Chunk {
    url: string;
    filename: string;
}

/**
 * Live Downloader
 */

export default class LiveDownloader extends Downloader {
    outputFileList: string[] = [];
    finishedList: string[] = [];
    currentPlaylist: M3U8;
    playlists: M3U8[] = [];
    chunks: Chunk[] = [];
    runningThreads: number = 0;
    finishedChunks: number = 0;

    isEncrypted: boolean = false;
    isEnd: boolean = false;
    isStarted: boolean = false;

    iv: string;
    prefix: string;

    /**
     * 
     * @param m3u8Path 
     * @param config
     * @param config.threads 线程数量 
     */
    constructor(m3u8Path: string, { threads, output, key }: DownloaderConfig = {
        threads: 5
    }) {
        super(m3u8Path, {
            threads,
            output,
            key
        });
    }

    async download() {
        if (!fs.existsSync(this.tempPath)) {
            fs.mkdirSync(this.tempPath);
        }
        if (process.platform === "win32") {
            var rl = require("readline").createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.on("SIGINT", function () {
                process.emit("SIGINT");
            });
        }

        process.on("SIGINT", () => {
            Log.info('Ctrl+C pressed, waiting for tasks finished.')
            this.isEnd = true;
        });


        this.currentPlaylist = await loadM3U8(this.m3u8Path);
        this.playlists.push(this.currentPlaylist);
        if (this.currentPlaylist.isEncrypted) {
            this.isEncrypted = true;
            const key = this.currentPlaylist.getKey();
            const iv = this.currentPlaylist.getIV();
            if (key.startsWith('abematv-license')) {
                Log.info('Site comfirmed: AbemaTV');
                const parser = await import('./parsers/abema');
                const parseResult = parser.default.parse({
                    key,
                    iv,
                    options: {
                        key: this.key
                    }
                });
                [this.key, this.iv, this.prefix] = [parseResult.key, parseResult.iv, parseResult.prefix];
                Log.info(`Key: ${this.key}; IV: ${this.iv}.`);
            } else if (key.startsWith('abemafresh')) {
                Log.info('Site comfirmed: FreshTV.');
                const parser = await import('./parsers/freshtv');
                const parseResult = parser.default.parse({
                    key,
                    iv
                });
                [this.key, this.iv, this.prefix] = [parseResult.key, parseResult.iv, parseResult.prefix];
                Log.info(`Key: ${this.key}; IV: ${this.iv}.`);
            } else {
                Log.error('Unknown site.')
            }
        } else {
            this.isEncrypted = false;
            // Not encrypted
            if (this.m3u8Path.includes('freshlive')) {
                // FreshTV
                Log.info('Site comfirmed: FreshTV.');
                const parser = await import('./parsers/freshtv');
                this.prefix = parser.default.prefix;
            }
        }
        await this.cycling();
    }

    async cycling() {
        while (true) {
            if (this.isEnd) {
                // 结束下载 进入合并流程
                break;
            }
            if (this.currentPlaylist.isEnd) {
                // 到达直播末尾
                this.isEnd = true;
            }
            const currentPlaylistChunks = [];
            this.currentPlaylist.chunks.forEach(chunk => {
                // 去重
                if (!this.finishedList.includes(chunk)) {
                    this.finishedList.push(chunk);
                    currentPlaylistChunks.push(chunk);
                }
            })
            const currentUndownloadedChunks = currentPlaylistChunks.map(chunk => {
                return {
                    url: this.prefix + chunk,
                    filename: chunk.match(/\/([^\/]+?\.ts)/)[1]
                }
            });
            // 加入待完成的任务列表
            this.chunks.push(...currentUndownloadedChunks);
            this.outputFileList.push(...currentUndownloadedChunks.map(chunk => {
                if (this.isEncrypted) {
                    return path.resolve(this.tempPath, `./${chunk.filename}.decrypt`);
                } else {
                    return path.resolve(this.tempPath, `./${chunk.filename}`);
                }
            }));

            this.currentPlaylist = await loadM3U8(this.m3u8Path);
            if (!this.isStarted) {
                this.isStarted = true;
                this.checkQueue();
            }
            await sleep(Math.min(5000, this.currentPlaylist.getChunkLength() * 1000));
        }
    }

    handleTask(task: Chunk) {
        return new Promise(async (resolve, reject) => {
            Log.debug(`Downloading ${task.filename}`);
            try {
                await download(task.url, path.resolve(this.tempPath, `./${task.filename}`));
                Log.debug(`Download ${task.filename} succeed.`);
                if (this.isEncrypted) {
                    await decrypt(path.resolve(this.tempPath, `./${task.filename}`), path.resolve(this.tempPath, `./${task.filename}`) + '.decrypt', this.key, this.iv);
                    Log.debug(`Decrypt ${task.filename} succeed`);
                }
                resolve();
            } catch (e) {
                Log.info(`Download or decrypt ${task.filename} failed. Retry later.`);
                reject(e);
            }
        });
    }

    checkQueue() {
        if (this.chunks.length > 0 && this.runningThreads < this.threads) {
            const task = this.chunks.shift();
            this.runningThreads++;
            this.handleTask(task).then(() => {
                this.finishedChunks++;
                this.runningThreads--;
                Log.info(`Proccess ${task.filename} finished. (${this.finishedChunks} / unknown)`);
                this.checkQueue();
            }).catch(e => {
                console.error(e);
                this.runningThreads--;
                this.chunks.push(task);
                this.checkQueue();
            });
            this.checkQueue();
        }
        if (this.chunks.length === 0 && this.runningThreads === 0 && this.isEnd) {
            // 结束状态 合并文件
            Log.info(`${this.finishedChunks} chunks downloaded. Start merging chunks.`);
            mergeVideo(this.outputFileList, this.outputPath).then(async () => {
                Log.info('End of merging.');
                Log.info('Starting cleaning temporary files.');
                await exec(`rm -rf ${this.tempPath}`);
                Log.info(`All finished. Check your file at [${this.outputPath}] .`);
            });
        }

        if (this.chunks.length === 0 && this.runningThreads === 0 && !this.isEnd) {
            // 空闲状态 一秒后再检查待完成任务列表
            sleep(1000).then(() => {
                this.checkQueue();
            });
        }
    }

}