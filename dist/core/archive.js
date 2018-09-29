"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const media_1 = require("../utils/media");
const system_1 = require("../utils/system");
const downloader_1 = require("./downloader");
const fs = require("fs");
const task_1 = require("../utils/task");
const time_1 = require("../utils/time");
const path = require('path');
class ArchiveDownloader extends downloader_1.default {
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(log, m3u8Path, { threads, output, key, verbose, nomux, retries, proxy, slice } = {
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
        this.chunks = [];
        this.allChunks = [];
        this.pickedChunks = [];
        this.finishedFilenames = [];
        this.runningThreads = 0;
        if (slice) {
            this.sliceStart = time_1.timeStringToSeconds(slice.split('-')[0]);
            this.sliceEnd = time_1.timeStringToSeconds(slice.split('-')[1]);
        }
    }
    /**
     * Parse M3U8 Information
     */
    parse() {
        return __awaiter(this, void 0, void 0, function* () {
            // parse m3u8
            if (this.m3u8.isEncrypted) {
                // Encrypted
                const key = this.m3u8.getKey();
                const iv = this.m3u8.getIV();
                if (key.startsWith('abemafresh')) {
                    this.Log.info('Site comfirmed: FreshTV.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/freshtv'));
                    const parseResult = parser.default.parse({
                        key,
                        iv
                    });
                    [this.key, this.iv, this.prefix] = [parseResult.key, parseResult.iv, parseResult.prefix];
                    this.Log.info(`Key: ${this.key}; IV: ${this.iv}.`);
                }
                else if (key.startsWith('abematv-license')) {
                    this.Log.info('Site comfirmed: AbemaTV.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/abema'));
                    const parseResult = parser.default.parse({
                        key,
                        iv,
                        options: {
                            key: this.key
                        }
                    });
                    [this.key, this.iv, this.prefix] = [parseResult.key, parseResult.iv, parseResult.prefix];
                    this.Log.info(`Key: ${this.key}; IV: ${this.iv}.`);
                }
                else if (this.m3u8Path.includes('bchvod')) {
                    this.Log.info('Site comfirmed: B-ch.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/bch'));
                    try {
                        const parseResult = yield parser.default.parse({
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
                    }
                    catch (e) {
                        yield this.clean();
                        this.Log.error('Fail to retrieve the key from server.');
                    }
                }
                else {
                    yield this.clean();
                    this.Log.error('Unsupported site.');
                }
            }
            else {
                // Not encrypted
                if (this.m3u8Path.includes('freshlive')) {
                    // FreshTV
                    this.Log.info('Site comfirmed: FreshTV.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/freshtv'));
                    this.prefix = parser.default.prefix;
                }
                else if (this.m3u8Path.includes('openrec')) {
                    // Openrec
                    this.Log.info('Site comfirmed: OPENREC.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/openrec'));
                    const parseResult = parser.default.parse({
                        options: {
                            m3u8Url: this.m3u8Path
                        }
                    });
                    this.prefix = parseResult.prefix;
                }
                else if (this.m3u8Path.includes('brightcove')) {
                    this.Log.info('Site comfirmed: Sony Music.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/sonymusic'));
                    const parseResult = parser.default.parse({
                        options: {
                            m3u8Url: this.m3u8Path
                        }
                    });
                    this.prefix = parseResult.prefix;
                }
                else if (this.m3u8Path.includes('dmc.nico')) {
                    // NicoNico
                    this.Log.info('Site comfirmed: NicoNico.');
                    this.Log.info('请保持播放页面不要关闭');
                    this.Log.info('Please do not close the video page.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/nico'));
                    const parseResult = parser.default.parse({
                        options: {
                            downloader: this,
                            m3u8Url: this.m3u8Path
                        }
                    });
                    this.prefix = parseResult.prefix;
                }
                else {
                    yield this.clean();
                    this.Log.error('Unsupported site.');
                }
            }
        });
    }
    download() {
        return __awaiter(this, void 0, void 0, function* () {
            // Record start time to calculate speed.
            this.startedAt = new Date().valueOf();
            // Allocate temporary directory.
            this.tempPath = path.resolve(__dirname, '../../temp_' + new Date().valueOf());
            if (!fs.existsSync(this.tempPath)) {
                fs.mkdirSync(this.tempPath);
            }
            process.on("SIGINT", () => __awaiter(this, void 0, void 0, function* () {
                yield this.clean();
                process.exit();
            }));
            yield this.parse();
            this.Log.info(`Start downloading with ${this.threads} thread(s).`);
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
                }
                else {
                    return path.resolve(this.tempPath, `./${chunk.filename}`);
                }
            });
            this.checkQueue();
        });
    }
    /**
     * calculate ETA
     */
    getETA() {
        const usedTime = new Date().valueOf() - this.startedAt;
        const remainingTimeInSeconds = Math.round(((usedTime / this.finishedChunksCount * this.totalChunksCount) - usedTime) / 1000);
        if (remainingTimeInSeconds < 60) {
            return `${remainingTimeInSeconds}s`;
        }
        else if (remainingTimeInSeconds < 3600) {
            return `${Math.floor(remainingTimeInSeconds / 60)}m ${remainingTimeInSeconds % 60}s`;
        }
        else {
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
                };
                this.Log.info(`Proccessing ${infoObj.taskname} finished. (${infoObj.finishedChunksCount} / ${this.totalChunksCount} or ${(infoObj.finishedChunksCount / infoObj.totalChunksCount * 100).toFixed(2)}% | Avg Speed: ${infoObj.chunkSpeed} chunks/s or ${infoObj.ratioSpeed}x | ETA: ${infoObj.eta})`, infoObj);
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
            this.Log.info('All chunks downloaded. Start merging chunks.');
            const muxer = this.nomux ? media_1.mergeVideoNew : media_1.mergeVideo;
            muxer(this.outputFileList, this.outputPath).then(() => __awaiter(this, void 0, void 0, function* () {
                this.Log.info('End of merging.');
                this.Log.info('Starting cleaning temporary files.');
                yield system_1.deleteDirectory(this.tempPath);
                try {
                    task_1.deleteTask(this.m3u8Path.split('?')[0]);
                }
                catch (error) {
                    this.Log.error('Fail to parse previous tasks, ignored.');
                }
                this.Log.info(`All finished. Check your file at [${this.outputPath}] .`);
                process.exit();
            })).catch(e => {
                //console.log(e);
                this.Log.error('Fail to merge video. Please merge video chunks manually.', e);
            });
        }
    }
    resume(taskId) {
        return __awaiter(this, void 0, void 0, function* () {
            const previousTask = task_1.getTask(taskId.split('?')[0]);
            if (!previousTask) {
                this.Log.error('Can\'t find a task to resume.');
            }
            this.Log.info('Previous task found. Resuming.');
            process.on("SIGINT", () => __awaiter(this, void 0, void 0, function* () {
                yield this.clean();
                process.exit();
            }));
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
            yield this.loadM3U8();
            yield this.parse();
            this.Log.info(`Start downloading with ${this.threads} thread(s).`);
            this.checkQueue();
        });
    }
    /**
    * 退出前的清理工作
    */
    clean() {
        return __awaiter(this, void 0, void 0, function* () {
            this.Log.info('Saving task status.');
            const unfinishedChunks = this.allChunks.filter(t => {
                return (!this.finishedFilenames.includes(t.filename));
            });
            this.Log.info(`Downloaded: ${this.finishedChunksCount}; Waiting for download: ${unfinishedChunks.length}`);
            try {
                task_1.saveTask({
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
            }
            catch (error) {
                this.Log.error('Fail to parse previous tasks, ignored.');
            }
            this.Log.info('Please wait.');
        });
    }
}
exports.default = ArchiveDownloader;
//# sourceMappingURL=archive.js.map