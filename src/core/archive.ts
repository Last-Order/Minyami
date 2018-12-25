import Logger from '../utils/log';
import { mergeToMKV, mergeToTS } from '../utils/media';
import { deleteDirectory } from '../utils/system';
import M3U8 from './m3u8';
import Downloader, { ArchiveDownloaderConfig, ChunkItem, isChunkGroup, Chunk } from './downloader';
import * as fs from 'fs';
import { saveTask, deleteTask, getTask } from '../utils/task';
import { timeStringToSeconds } from '../utils/time';
import { sleep } from './action';
const path = require('path');

class ArchiveDownloader extends Downloader {
    tempPath: string;
    m3u8Path: string;
    m3u8: M3U8;

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

    globalPause: boolean = false;

    /**
     * 
     * @param m3u8Path 
     * @param config
     * @param config.threads 线程数量 
     */
    constructor(log: Logger, m3u8Path?: string, { threads, output, key, verbose, nomux, retries, proxy, slice, format }: ArchiveDownloaderConfig = {
        threads: 5
    }) {
        super(log, m3u8Path, {
            threads,
            output,
            key,
            verbose,
            nomux,
            retries,
            proxy,
            format
        });
        if (slice) {
            this.sliceStart = timeStringToSeconds(slice.split('-')[0]);
            this.sliceEnd = timeStringToSeconds(slice.split('-')[1]);
        }
    }

    pauseLoop() {
        this.globalPause = true;
    } 

    resumeLoop() {
        this.globalPause = false;
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
                this.Log.info('Site comfirmed: FreshTV.');
                const parser = await import('./parsers/freshtv');
                parser.default.parse({
                    downloader: this
                });
                this.Log.info(`Key: ${this.m3u8.key}; IV: ${this.m3u8.iv}.`);
            } else if (key.startsWith('abematv-license')) {
                this.Log.info('Site comfirmed: AbemaTV.');
                const parser = await import('./parsers/abema');
                parser.default.parse({
                    downloader: this
                });
                this.Log.info(`Key: ${this.key}; IV: ${this.m3u8.iv}.`);
            } else if (this.m3u8Path.includes('dmm.com')) {
                this.Log.info('Site comfirmed: DMM.');
                const parser = await import('./parsers/dmm');
                parser.default.parse({
                    downloader: this
                });
                this.Log.info(`Key: ${this.key}; IV: ${this.m3u8.sequenceId}.`);
            } else if (this.m3u8Path.includes('bchvod')) {
                this.Log.info('Site comfirmed: B-ch.');
                const parser = await import('./parsers/bch');
                try {
                    await parser.default.parse({
                        downloader: this
                    });
                    this.Log.info(`Key: ${this.m3u8.key}; IV: ${this.m3u8.sequenceId}.`);
                } catch (e) {
                    await this.clean();
                    this.Log.error('Fail to retrieve the key from server.');
                }
            } else {
                this.Log.warning(`Site is not supported by Minyami Core. Try common parser.`);
                const parser = await import('./parsers/common');
                await parser.default.parse({
                    downloader: this
                });
            }
        } else {
            // Not encrypted
            if (this.m3u8Path.includes('dmc.nico')) {
                // NicoNico
                this.Log.info('Site comfirmed: NicoNico.');
                const parser = await import('./parsers/nico');
                if (!this.key) {
                    this.Log.info('请保持播放页面不要关闭');
                    this.Log.info('Please do not close the video page.');
                    this.Log.info(`Maybe you should get a audience token to get a better user experience.`);
                }
                if (this.threads > 10) {
                    this.Log.warning(`High threads setting detected. Use at your own risk!`);
                }
                parser.default.parse({
                    downloader: this
                });
                this.autoGenerateChunkList = false;
            } else {
                this.Log.warning(`Site is not supported by Minyami Core. Try common parser.`);
                const parser = await import('./parsers/common');
                await parser.default.parse({
                    downloader: this
                });
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

        this.Log.info(`Start downloading with ${this.threads} thread(s).`);
        if (this.autoGenerateChunkList) {
            this.chunks = this.m3u8.chunks.map(chunk => {
                return {
                    url: chunk.url,
                    filename: chunk.url.match(/\/*([^\/]+?\.ts)/)[1],
                    key: chunk.key,
                    iv: chunk.iv,
                    sequenceId: chunk.sequenceId
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
                            if (nowTime + this.m3u8.getChunkLength() >= this.sliceStart && nowTime + this.m3u8.getChunkLength() < this.sliceEnd) {
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

        this.allChunks = this.chunks.map(chunk => {
            if (isChunkGroup(chunk)) {
                return {
                    ...chunk,
                    chunks: [...chunk.chunks]
                }
            } else {
                return chunk;
            }
        })

        this.totalChunksCount = 0;
        for (const chunk of this.chunks) {
            this.totalChunksCount += isChunkGroup(chunk) ? chunk.chunks.length : 1;
        }

        this.outputFileList = [];
        this.chunks.forEach(chunkItem => {
            if (!isChunkGroup(chunkItem)) {
                if (this.m3u8.isEncrypted) {
                    this.outputFileList.push(path.resolve(this.tempPath, `./${chunkItem.filename}.decrypt`));
                } else {
                    this.outputFileList.push(path.resolve(this.tempPath, `./${chunkItem.filename}`));
                }
            } else {
                for (const chunk of chunkItem.chunks) {
                    if (this.m3u8.isEncrypted) {
                        this.outputFileList.push(path.resolve(this.tempPath, `./${chunk.filename}.decrypt`));
                    } else {
                        this.outputFileList.push(path.resolve(this.tempPath, `./${chunk.filename}`));
                    }
                }
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
    async checkQueue() {
        if (this.globalPause) {
            await sleep(1);
            this.checkQueue();
            return;
        }
        if (this.chunks.length > 0 && this.runningThreads < this.threads) {
            const task = this.chunks[0];
            let chunk: Chunk;
            if (isChunkGroup(task)) {
                if (task.actions && task.isNew) {
                    this.verbose && this.Log.debug(`Handle chunk actions for a new chunk group.`);
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
                } else {
                    // All chunks finished in group
                    this.verbose && this.Log.debug(`Skip a empty chunk group.`);
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
            this.handleTask(chunk).then(() => {
                this.finishedChunksCount++;
                this.runningThreads--;
                let infoObj = {
                    taskname: chunk.filename,
                    finishedChunksCount: this.finishedChunksCount,
                    totalChunksCount: this.totalChunksCount,
                    chunkSpeed: this.calculateSpeedByChunk(),
                    ratioSpeed: this.calculateSpeedByRatio(),
                    eta: this.getETA()
                }

                this.Log.info(`Proccessing ${infoObj.taskname} finished. (${infoObj.finishedChunksCount} / ${this.totalChunksCount} or ${(infoObj.finishedChunksCount / infoObj.totalChunksCount * 100).toFixed(2)}% | Avg Speed: ${
                    infoObj.chunkSpeed
                    } chunks/s or ${
                    infoObj.ratioSpeed
                    }x | ETA: ${
                    infoObj.eta
                    })`, infoObj);
                this.finishedFilenames[chunk.filename] = true;
                this.checkQueue();
            }).catch(e => {
                this.runningThreads--;
                if (chunk.parentGroup) {
                    if (chunk.parentGroup.isFinished) {
                        // Add a new group to the queue.
                        this.chunks.push({
                            chunks: [chunk],
                            actions: chunk.parentGroup.actions,
                            isFinished: false,
                            isNew: true
                        });
                    } else {
                        chunk.parentGroup.chunks.push(chunk);
                    }
                } else {
                    this.chunks.push(chunk);
                }
                this.checkQueue();
            });
            this.checkQueue();
        }
        if (this.chunks.length === 0 && this.runningThreads === 0) {
            this.Log.info('All chunks downloaded. Start merging chunks.');
            const muxer = this.format === 'ts' ? mergeToTS : mergeToMKV;
            muxer(this.outputFileList, this.outputPath).then(async () => {
                this.Log.info('End of merging.');
                this.Log.info('Starting cleaning temporary files.');
                await deleteDirectory(this.tempPath);
                try {
                    deleteTask(this.m3u8Path.split('?')[0]);
                } catch (error) {
                    this.Log.error('Fail to parse previous tasks, ignored.');
                }
                this.Log.info(`All finished. Check your file at [${this.outputPath}] .`);
                process.exit();
            }).catch(async e => {
                await this.clean();
                this.Log.error('Fail to merge video. Please merge video chunks manually.', e);
            });
        }
    }

    async resume(taskId: string) {
        const previousTask = getTask(taskId.split('?')[0]);
        if (!previousTask) {
            this.Log.error('Can\'t find a task to resume.');
        }
        this.Log.info('Previous task found. Resuming.');

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

        this.Log.info(`Start downloading with ${this.threads} thread(s).`);
        this.checkQueue();
    }

    /**
    * 退出前的清理工作
    */
    async clean() {
        this.Log.info('Saving task status.');
        const unfinishedChunks: ChunkItem[] = [];
        this.allChunks.forEach(chunkItem => {
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
                        chunks: unfinishedChunksInItem
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

        this.Log.info(`Downloaded: ${this.finishedChunksCount}; Waiting for download: ${unfinishedChunksLength}`);

        try {
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
                finishedChunksCount: this.totalChunksCount - unfinishedChunksLength,
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
        } catch (error) {
            this.Log.error('Fail to parse previous tasks, ignored.');
        }
        this.Log.info('Please wait.');
    }
}

export default ArchiveDownloader;