import Logger from '../utils/log';
let Log = Logger.getInstance();
import { mergeVideo, mergeVideoNew } from '../utils/media';
import { deleteDirectory, sleep } from '../utils/system';
import M3U8 from './m3u8';
import Downloader, { Chunk, ArchiveDownloaderConfig } from './downloader';
import * as fs from 'fs';
import { saveTask, deleteTask, getTask } from '../utils/task';
import { timeStringToSeconds } from '../utils/time';
const path = require('path');

class ArchiveDownloader extends Downloader {
    tempPath: string;
    m3u8Path: string;
    m3u8: M3U8;

    chunks: Chunk[] = [];
    allChunks: Chunk[] = [];
    pickedChunks: Chunk[] = [];
    finishedFilenames: string[] = [];
    outputFileList: string[];

    totalChunksCount: number;
    runningThreads: number = 0;

    sliceStart: number;
    sliceEnd: number;

    prefix: string;

    /**
     * 
     * @param m3u8Path 
     * @param config
     * @param config.threads 线程数量 
     */
    constructor(m3u8Path?: string, { threads, output, key, verbose, nomux, retries, proxy, slice }: ArchiveDownloaderConfig = {
        threads: 5
    }) {
        super(m3u8Path, {
            threads,
            output,
            key,
            verbose,
            nomux,
            retries,
            proxy
        });
        if (slice) {
            this.sliceStart = timeStringToSeconds(slice.split('-')[0]);
            this.sliceEnd = timeStringToSeconds(slice.split('-')[1]);
        }
    }

    /**
     * Parse M3U8 Information
     */
    async parse() {
        // parse m3u8
        if (this.m3u8.isEncrypted) {
            // Encrypted
            const key = this.m3u8.getKey();
            const iv = this.m3u8.getIV();

            if (key.startsWith('abemafresh')) {
                Log.info('Site comfirmed: FreshTV.');
                const parser = await import('./parsers/freshtv');
                const parseResult = parser.default.parse({
                    key,
                    iv
                });
                [this.key, this.iv, this.prefix] = [parseResult.key, parseResult.iv, parseResult.prefix];
                Log.info(`Key: ${this.key}; IV: ${this.iv}.`);
            } else if (key.startsWith('abematv-license')) {
                Log.info('Site comfirmed: AbemaTV.');
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
            } else if (this.m3u8Path.includes('bchvod')) {
                Log.info('Site comfirmed: B-ch.');
                const parser = await import('./parsers/bch');
                try {
                    const parseResult = await parser.default.parse({
                        key,
                        options: {
                            m3u8: this.m3u8,
                            proxy: {
                                host: this.proxyHost,
                                port: this.proxyPort
                            }
                        }
                    });
                    [this.key, this.iv, this.prefix] = [parseResult.key, parseResult.iv, parseResult.prefix];
                    Log.info(`Key: ${this.key}; IV: ${this.iv}.`);
                } catch (e) {
                    await this.clean();
                    Log.error('Fail to retrieve the key from server.');
                }
            } else {
                await this.clean();
                Log.error('Unsupported site.');
            }
        } else {
            // Not encrypted
            if (this.m3u8Path.includes('freshlive')) {
                // FreshTV
                Log.info('Site comfirmed: FreshTV.');
                const parser = await import('./parsers/freshtv');
                this.prefix = parser.default.prefix;
            } else if (this.m3u8Path.includes('openrec')) {
                // Openrec
                Log.info('Site comfirmed: OPENREC.');
                const parser = await import('./parsers/openrec');
                const parseResult = parser.default.parse({
                    options: {
                        m3u8Url: this.m3u8Path
                    }
                });
                this.prefix = parseResult.prefix;
            } else if (this.m3u8Path.includes('brightcove')) {
                Log.info('Site comfirmed: Sony Music.');
                const parser = await import('./parsers/sonymusic');
                const parseResult = parser.default.parse({
                    options: {
                        m3u8Url: this.m3u8Path
                    }
                });
                this.prefix = parseResult.prefix;
            } else if (this.m3u8Path.includes('dmc.nico')) {
                // NicoNico
                Log.info('Site comfirmed: NicoNico.');
                Log.info('请保持播放页面不要关闭');
                Log.info('Please do not close the video page.');
                const parser = await import('./parsers/nico');
                const parseResult = parser.default.parse({
                    options: {
                        downloader: this,
                        m3u8Url: this.m3u8Path
                    }
                });
                this.prefix = parseResult.prefix;
            } else {
                await this.clean();
                Log.error('Unsupported site.');
            }
        }
    }

    async download() {
        // Record start time to calculate speed.
        this.startedAt = new Date().valueOf();
        // Allocate temporary directory.
        this.tempPath = path.resolve(__dirname, '../../temp_' + new Date().valueOf());

        if (!fs.existsSync(this.tempPath)) {
            fs.mkdirSync(this.tempPath);
        }

        process.on("SIGINT", async () => {
            await this.clean();
            process.exit();
        });

        await this.parse();

        Log.info(`Start downloading with ${this.threads} thread(s).`);

        this.chunks = this.m3u8.chunks.map(chunk => {
            return {
                url: this.prefix + chunk,
                filename: chunk.match(/\/*([^\/]+?\.ts)/)[1]
            };
        });

        if (this.sliceStart && this.sliceEnd) {
            const startIndex = Math.floor(this.sliceStart / this.m3u8.getChunkLength());
            const endIndex = Math.floor(this.sliceEnd / this.m3u8.getChunkLength());
            this.chunks = this.chunks.slice(startIndex, endIndex);
        }

        this.allChunks = [...this.chunks];
        this.totalChunksCount = this.chunks.length;
        this.outputFileList = this.chunks.map(chunk => {
            if (this.m3u8.isEncrypted) {
                return path.resolve(this.tempPath, `./${chunk.filename}.decrypt`);
            } else {
                return path.resolve(this.tempPath, `./${chunk.filename}`);
            }
        })
        this.checkQueue();
    }


    /**
     * calculate ETA
     */
    getETA() {
        const usedTime = new Date().valueOf() - this.startedAt;
        const remainingTimeInSeconds = Math.round(((usedTime / this.finishedChunksCount * this.totalChunksCount) - usedTime) / 1000)
        if (remainingTimeInSeconds < 60) {
            return `${remainingTimeInSeconds}s`;
        } else if (remainingTimeInSeconds < 3600) {
            return `${Math.floor(remainingTimeInSeconds / 60)}m ${remainingTimeInSeconds % 60}s`;
        } else {
            return `${Math.floor(remainingTimeInSeconds / 3600)}h ${Math.floor((remainingTimeInSeconds % 3600) / 60)}m ${remainingTimeInSeconds % 60}s`;
        }
    }

    /**
     * Check task queue
     */
    checkQueue() {
        if (this.chunks.length > 0 && this.runningThreads < this.threads) {
            const task = this.chunks.shift();
            this.pickedChunks.push(task);
            this.runningThreads++;
            this.handleTask(task).then(() => {
                this.finishedChunksCount++;
                this.runningThreads--;
                let infoObj = {
                    taskname: task.filename,
                    finishedChunksCount: this.finishedChunksCount,
                    totalChunksCount: this.totalChunksCount,
                    chunkSpeed: this.calculateSpeedByChunk(),
                    ratioSpeed: this.calculateSpeedByRatio(),
                    eta: this.getETA()
                }

                Log.info(`Proccessing ${infoObj.taskname} finished. (${infoObj.finishedChunksCount} / ${this.totalChunksCount} or ${(infoObj.finishedChunksCount / infoObj.totalChunksCount * 100).toFixed(2)}% | Avg Speed: ${
                    infoObj.chunkSpeed
                    } chunks/s or ${
                    infoObj.ratioSpeed
                    }x | ETA: ${
                    infoObj.eta
                    })`, infoObj);
                this.finishedFilenames.push(task.filename);
                this.checkQueue();
            }).catch(e => {
                this.runningThreads--;
                this.chunks.push(task);
                this.checkQueue();
            });
            this.checkQueue();
        }
        if (this.chunks.length === 0 && this.runningThreads === 0) {
            Log.info('All chunks downloaded. Start merging chunks.');
            const muxer = this.nomux ? mergeVideoNew : mergeVideo;
            muxer(this.outputFileList, this.outputPath).then(async () => {
                Log.info('End of merging.');
                Log.info('Starting cleaning temporary files.');
                await deleteDirectory(this.tempPath);
                deleteTask(this.m3u8Path.split('?')[0]);
                Log.info(`All finished. Check your file at [${this.outputPath}] .`);
                process.exit();
            }).catch(e => {
                //console.log(e);
                Log.error('Fail to merge video. Please merge video chunks manually.', e);
            });
        }
    }

    async resume(taskId: string) {
        const previousTask = getTask(taskId.split('?')[0]);
        if (!previousTask) {
            Log.error('Can\'t find a task to resume.');
        } 
        Log.info('Previous task found. Resuming.');

        process.on("SIGINT", async () => {
            await this.clean();
            process.exit();
        });

        this.m3u8Path = taskId;
        // Resume status
        this.tempPath = previousTask.tempPath;
        this.outputPath = previousTask.outputPath;
        this.threads = previousTask.threads;
        this.key = previousTask.key;
        this.iv = previousTask.iv;
        this.verbose = previousTask.verbose;
        this.nomux = previousTask.nomux;
        this.startedAt = new Date().valueOf();
        this.finishedChunksCount = 0;
        this.totalChunksCount = previousTask.totalChunksCount - previousTask.finishedChunksCount;
        this.retries = previousTask.retries;
        this.timeout = previousTask.timeout;
        this.proxy = previousTask.proxy;
        this.proxyHost = previousTask.proxyHost;
        this.proxyPort = previousTask.proxyPort;
        this.allChunks = previousTask.allChunks;
        this.chunks = previousTask.chunks;
        this.outputFileList = previousTask.outputFileList;
        this.finishedFilenames = previousTask.finishedFilenames;
        // Load M3U8
        await this.loadM3U8();
        await this.parse();

        Log.info(`Start downloading with ${this.threads} thread(s).`);
        this.checkQueue();
    }

    /**
    * 退出前的清理工作
    */
    async clean() {
        Log.info('Saving task status.');
        const unfinishedChunks = this.allChunks.filter(t => {
            return (!this.finishedFilenames.includes(t.filename));
        });
        Log.info(`Downloaded: ${this.finishedChunksCount}; Waiting for download: ${unfinishedChunks.length}`);
        saveTask({
            id: this.m3u8Path.split('?')[0],
            tempPath: this.tempPath,
            m3u8Path: this.m3u8Path,
            outputPath: this.outputPath,
            threads: this.threads,
            key: this.key,
            iv: this.iv,
            verbose: this.verbose,
            nomux: this.nomux,
            startedAt: this.startedAt,
            finishedChunksCount: this.totalChunksCount - unfinishedChunks.length,
            totalChunksCount: this.totalChunksCount,
            retries: this.retries,
            timeout: this.timeout,
            proxy: this.proxy,
            proxyHost: this.proxyHost,
            proxyPort: this.proxyPort,
            allChunks: this.allChunks,
            chunks: unfinishedChunks,
            outputFileList: this.outputFileList,
            finishedFilenames: this.finishedFilenames
        });
        Log.info('Please wait.');
    }
}

export default ArchiveDownloader;