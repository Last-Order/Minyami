import Log from '../utils/log';
import { mergeVideo, mergeVideoNew } from '../utils/media';
import { deleteDirectory } from '../utils/system';
import M3U8 from './m3u8';
import Downloader, { DownloaderConfig, Chunk } from './downloader';
const path = require('path');

class ArchiveDownloader extends Downloader {
    tempPath: string;
    m3u8Path: string;
    m3u8: M3U8;

    chunks: Chunk[];
    outputFileList: string[];

    totalChunks: number;
    runningThreads: number = 0;

    prefix: string;

    /**
     * 
     * @param m3u8Path 
     * @param config
     * @param config.threads 线程数量 
     */
    constructor(m3u8Path: string, { threads, output, key, verbose, nomux, retries, proxy }: DownloaderConfig = {
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
    }

    async download() {
        this.startedAt = new Date().valueOf();

        process.on("SIGINT", async () => {
            await this.clean();
            process.exit();
        });

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
                        m3u8Url: this.m3u8Path,
                        m3u8: this.m3u8
                    }
                });
                this.prefix = parseResult.prefix;
                this.m3u8 = parseResult.m3u8;
            } else {
                await this.clean();
                Log.error('Unsupported site.');
            }
        }

        Log.info(`Start downloading with ${this.threads} thread(s).`);
        this.chunks = this.m3u8.chunks.map(chunk => {
            return {
                url: this.prefix + chunk,
                filename: chunk.match(/\/*([^\/]+?\.ts)/)[1]
            };
        });
        this.totalChunks = this.chunks.length;
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
        const remainingTimeInSeconds = Math.round(((usedTime / this.finishedChunks * this.totalChunks) - usedTime) / 1000)
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
            this.runningThreads++;
            this.handleTask(task).then(() => {
                this.finishedChunks++;
                this.runningThreads--;
                Log.info(`Proccessing ${task.filename} finished. (${this.finishedChunks} / ${this.totalChunks} or ${(this.finishedChunks / this.totalChunks * 100).toFixed(2)}% | Avg Speed: ${
                    this.calculateSpeedByChunk()
                    } chunks/s or ${
                    this.calculateSpeedByRatio()
                    }x | ETA: ${
                    this.getETA()
                    })`);
                this.checkQueue();
            }).catch(e => {
                console.error(e);
                console.log(task);
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
                Log.info(`All finished. Check your file at [${this.outputPath}] .`);
            }).catch(e => {
                console.log(e);
                Log.error('Fail to merge video. Please merge video chunks manually.');
            });
        }
    }
}

export default ArchiveDownloader;