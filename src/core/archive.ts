import Logger from '../utils/log';
import { mergeVideo, mergeVideoNew } from '../utils/media';
import { deleteDirectory } from '../utils/system';
import M3U8 from './m3u8';
import Downloader, { ArchiveDownloaderConfig, ChunkItem, isChunkGroup, Chunk, ChunkGroup } from './downloader';
import * as fs from 'fs';
import { saveTask, deleteTask, getTask } from '../utils/task';
import { timeStringToSeconds } from '../utils/time';
const path = require('path');

class ArchiveDownloader extends Downloader {
    tempPath: string;
    m3u8Path: string;
    m3u8: M3U8;

    chunks: ChunkItem[] = [];
    allChunks: ChunkItem[] = [];
    pickedChunks: ChunkItem[] = [];
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
    constructor(log:Logger, m3u8Path?: string, { threads, output, key, verbose, nomux, retries, proxy, slice }: ArchiveDownloaderConfig = {
        threads: 5
    }) {
        super(log, m3u8Path, {
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
                this.Log.info('Site comfirmed: FreshTV.');
                const parser = await import('./parsers/freshtv');
                const parseResult = parser.default.parse({
                    key,
                    iv
                });
                [this.key, this.iv, this.prefix] = [parseResult.key, parseResult.iv, parseResult.prefix];
                this.Log.info(`Key: ${this.key}; IV: ${this.iv}.`);
            } else if (key.startsWith('abematv-license')) {
                this.Log.info('Site comfirmed: AbemaTV.');
                const parser = await import('./parsers/abema');
                const parseResult = parser.default.parse({
                    key,
                    iv,
                    options: {
                        key: this.key
                    }
                });
                [this.key, this.iv, this.prefix] = [parseResult.key, parseResult.iv, parseResult.prefix];
                this.Log.info(`Key: ${this.key}; IV: ${this.iv}.`);
            } else if (this.m3u8Path.includes('bchvod')) {
                this.Log.info('Site comfirmed: B-ch.');
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
                    this.Log.info(`Key: ${this.key}; IV: ${this.iv}.`);
                } catch (e) {
                    await this.clean();
                    this.Log.error('Fail to retrieve the key from server.');
                }
            } else {
                await this.clean();
                this.Log.error('Unsupported site.');
            }
        } else {
            // Not encrypted
            if (this.m3u8Path.includes('freshlive')) {
                // FreshTV
                this.Log.info('Site comfirmed: FreshTV.');
                const parser = await import('./parsers/freshtv');
                this.prefix = parser.default.prefix;
            } else if (this.m3u8Path.includes('openrec')) {
                // Openrec
                this.Log.info('Site comfirmed: OPENREC.');
                const parser = await import('./parsers/openrec');
                const parseResult = parser.default.parse({
                    options: {
                        m3u8Url: this.m3u8Path
                    }
                });
                this.prefix = parseResult.prefix;
            } else if (this.m3u8Path.includes('brightcove')) {
                this.Log.info('Site comfirmed: Sony Music.');
                const parser = await import('./parsers/sonymusic');
                const parseResult = parser.default.parse({
                    options: {
                        m3u8Url: this.m3u8Path
                    }
                });
                this.prefix = parseResult.prefix;
            } else if (this.m3u8Path.includes('dmc.nico')) {
                // NicoNico
                this.Log.info('Site comfirmed: NicoNico.');
                this.Log.info('请保持播放页面不要关闭');
                this.Log.info('Please do not close the video page.');
                const parser = await import('./parsers/nico');
                const parseResult = parser.default.parse({
                    options: {
                        downloader: this,
                        m3u8Url: this.m3u8Path
                    }
                });
                this.prefix = parseResult.prefix;
                this.autoGenerateChunkList = false;
            } else {
                await this.clean();
                this.Log.error('Unsupported site.');
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
                    url: this.prefix + chunk,
                    filename: chunk.match(/\/*([^\/]+?\.ts)/)[1]
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

        this.allChunks = [...this.chunks];

        this.totalChunksCount = 0;
        for (const chunk of this.chunks) {
            if (isChunkGroup(chunk)) {
                this.totalChunksCount += chunk.chunks.length;
            } else {
                this.totalChunksCount += 1;
            }
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
                this.finishedFilenames.push(chunk.filename);
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
            const muxer = this.nomux ? mergeVideoNew : mergeVideo;
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
            }).catch(e => {
                //console.log(e);
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
        const unfinishedChunks = this.allChunks.filter(t => {
            return (isChunkGroup(t) || !this.finishedFilenames.includes(t.filename));
        });
        this.Log.info(`Downloaded: ${this.finishedChunksCount}; Waiting for download: ${unfinishedChunks.length}`);

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
        } catch (error) {
            this.Log.error('Fail to parse previous tasks, ignored.');
        }
        this.Log.info('Please wait.');
    }
}

export default ArchiveDownloader;