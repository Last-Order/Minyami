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
const downloader_1 = require("./downloader");
const log_1 = require("../utils/log");
let Log = log_1.default.getInstance();
const media_1 = require("../utils/media");
const system_1 = require("../utils/system");
const path = require('path');
const fs = require('fs');
/**
 * Live Downloader
 */
class LiveDownloader extends downloader_1.default {
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(m3u8Path, { threads, output, key, verbose, nomux, retries, proxy } = {
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
        this.outputFileList = [];
        this.finishedList = [];
        this.playlists = [];
        this.chunks = [];
        this.runningThreads = 0;
        this.isEncrypted = false;
        this.isEnd = false;
        this.isStarted = false;
        this.forceStop = false;
        this.retries = 3;
        if (retries) {
            this.retries = retries;
        }
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
                if (!this.forceStop) {
                    Log.info('Ctrl+C pressed, waiting for tasks finished.');
                    this.isEnd = true;
                    this.forceStop = true;
                }
                else {
                    Log.info('Force stop.'); // TODO: reject all download promises
                    yield this.clean();
                    process.exit();
                }
            }));
            yield this.loadM3U8();
            this.playlists.push(this.m3u8);
            this.timeout = this.m3u8.getChunkLength() * this.m3u8.chunks.length * 1000;
            if (this.m3u8.isEncrypted) {
                this.isEncrypted = true;
                const key = this.m3u8.getKey();
                const iv = this.m3u8.getIV();
                if (key.startsWith('abematv-license')) {
                    Log.info('Site comfirmed: AbemaTV');
                    const parser = yield Promise.resolve().then(() => require('./parsers/abema'));
                    const parseResult = parser.default.parse({
                        key,
                        iv,
                        options: {
                            key: this.key
                        }
                    });
                    [this.key, this.iv, this.prefix] = [parseResult.key, parseResult.iv, parseResult.prefix];
                    Log.info(`Key: ${this.key}; IV: ${this.iv}.`);
                }
                else if (key.startsWith('abemafresh')) {
                    Log.info('Site comfirmed: FreshTV.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/freshtv'));
                    const parseResult = parser.default.parse({
                        key,
                        iv
                    });
                    [this.key, this.iv, this.prefix] = [parseResult.key, parseResult.iv, parseResult.prefix];
                    Log.info(`Key: ${this.key}; IV: ${this.iv}.`);
                }
                else {
                    Log.error('Unknown site.');
                }
            }
            else {
                this.isEncrypted = false;
                // Not encrypted
                if (this.m3u8Path.includes('freshlive')) {
                    // FreshTV
                    Log.info('Site comfirmed: FreshTV.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/freshtv'));
                    this.prefix = parser.default.prefix;
                }
                else if (this.m3u8Path.includes('openrec')) {
                    // Openrec
                    Log.info('Site comfirmed: OPENREC.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/openrec'));
                    const parseResult = parser.default.parse({
                        options: {
                            m3u8Url: this.m3u8Path
                        }
                    });
                    this.prefix = parseResult.prefix;
                }
                else if (this.m3u8Path.includes('showroom')) {
                    // SHOWROOM
                    Log.info('Site comfirmed: SHOWROOM.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/showroom'));
                    const parseResult = parser.default.parse({
                        options: {
                            m3u8Url: this.m3u8Path
                        }
                    });
                    this.prefix = parseResult.prefix;
                }
                else if (this.m3u8Path.includes('dmc.nico')) {
                    // NicoNico
                    Log.info('Site comfirmed: NicoNico.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/nico'));
                    const parseResult = parser.default.parse({
                        options: {
                            m3u8Url: this.m3u8Path
                        }
                    });
                    this.prefix = parseResult.prefix;
                }
                else {
                    yield this.clean();
                    Log.error('Unsupported site.');
                }
            }
            yield this.cycling();
        });
    }
    cycling() {
        return __awaiter(this, void 0, void 0, function* () {
            while (true) {
                if (this.isEnd) {
                    // 结束下载 进入合并流程
                    break;
                }
                if (this.m3u8.isEnd) {
                    // 到达直播末尾
                    this.isEnd = true;
                }
                const currentPlaylistChunks = [];
                this.m3u8.chunks.forEach(chunk => {
                    // 去重
                    if (!this.finishedList.includes(chunk)) {
                        this.finishedList.push(chunk);
                        currentPlaylistChunks.push(chunk);
                    }
                });
                const currentUndownloadedChunks = currentPlaylistChunks.map(chunk => {
                    return {
                        url: this.prefix + chunk,
                        filename: chunk.match(/\/*([^\/]+?\.ts)/)[1]
                    };
                });
                // 加入待完成的任务列表
                this.chunks.push(...currentUndownloadedChunks);
                this.outputFileList.push(...currentUndownloadedChunks.map(chunk => {
                    if (this.isEncrypted) {
                        return path.resolve(this.tempPath, `./${chunk.filename}.decrypt`);
                    }
                    else {
                        return path.resolve(this.tempPath, `./${chunk.filename}`);
                    }
                }));
                yield this.loadM3U8();
                if (!this.isStarted) {
                    this.isStarted = true;
                    this.checkQueue();
                }
                yield system_1.sleep(Math.min(5000, this.m3u8.getChunkLength() * 1000));
            }
        });
    }
    checkQueue() {
        if (this.chunks.length > 0 && this.runningThreads < this.threads) {
            const task = this.chunks.shift();
            this.runningThreads++;
            this.handleTask(task).then(() => {
                this.finishedChunksCount++;
                this.runningThreads--;
                let infoObj = {
                    taskname: task.filename,
                    finishedChunksCount: this.finishedChunksCount,
                    chunkSpeed: this.calculateSpeedByChunk(),
                    ratioSpeed: this.calculateSpeedByRatio()
                };
                Log.info(`Proccessing ${infoObj.taskname} finished. (${infoObj.finishedChunksCount} / unknown | Avg Speed: ${infoObj.chunkSpeed}chunks/s or ${infoObj.ratioSpeed}x)`, infoObj);
                this.checkQueue();
            }).catch(e => {
                //console.error(e);
                //console.log(task, this.m3u8);
                Log.info(JSON.stringify(task) + " " + JSON.stringify(this.m3u8));
                Log.error("Something happenned.", e);
                this.runningThreads--;
                this.chunks.push(task);
                this.checkQueue();
            });
            this.checkQueue();
        }
        if (this.chunks.length === 0 && this.runningThreads === 0 && this.isEnd) {
            // 结束状态 合并文件
            Log.info(`${this.finishedChunksCount} chunks downloaded. Start merging chunks.`);
            const muxer = this.nomux ? media_1.mergeVideoNew : media_1.mergeVideo;
            muxer(this.outputFileList, this.outputPath).then(() => __awaiter(this, void 0, void 0, function* () {
                Log.info('End of merging.');
                yield this.clean();
                Log.info(`All finished. Check your file at [${this.outputPath}] .`);
                process.exit();
            })).catch(e => {
                //console.log(e);
                Log.error('Fail to merge video. Please merge video chunks manually.', e);
            });
        }
        if (this.chunks.length === 0 && this.runningThreads === 0 && !this.isEnd) {
            // 空闲状态 一秒后再检查待完成任务列表
            system_1.sleep(1000).then(() => {
                this.checkQueue();
            });
        }
    }
}
exports.default = LiveDownloader;
//# sourceMappingURL=live.js.map