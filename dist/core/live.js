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
const m3u8_1 = require("../utils/m3u8");
const log_1 = require("../utils/log");
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
    constructor(m3u8Path, { threads, output, key } = {
        threads: 5
    }) {
        super(m3u8Path, {
            threads,
            output,
            key
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
    }
    download() {
        return __awaiter(this, void 0, void 0, function* () {
            this.startedAt = new Date().valueOf();
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
                if (!this.forceStop) {
                    log_1.default.info('Ctrl+C pressed, waiting for tasks finished.');
                    this.isEnd = true;
                    this.forceStop = true;
                }
                else {
                    log_1.default.info('Force stop.');
                    process.exit();
                }
            });
            this.m3u8 = yield m3u8_1.loadM3U8(this.m3u8Path);
            this.playlists.push(this.m3u8);
            if (this.m3u8.isEncrypted) {
                this.isEncrypted = true;
                const key = this.m3u8.getKey();
                const iv = this.m3u8.getIV();
                if (key.startsWith('abematv-license')) {
                    log_1.default.info('Site comfirmed: AbemaTV');
                    const parser = yield Promise.resolve().then(() => require('./parsers/abema'));
                    const parseResult = parser.default.parse({
                        key,
                        iv,
                        options: {
                            key: this.key
                        }
                    });
                    [this.key, this.iv, this.prefix] = [parseResult.key, parseResult.iv, parseResult.prefix];
                    log_1.default.info(`Key: ${this.key}; IV: ${this.iv}.`);
                }
                else if (key.startsWith('abemafresh')) {
                    log_1.default.info('Site comfirmed: FreshTV.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/freshtv'));
                    const parseResult = parser.default.parse({
                        key,
                        iv
                    });
                    [this.key, this.iv, this.prefix] = [parseResult.key, parseResult.iv, parseResult.prefix];
                    log_1.default.info(`Key: ${this.key}; IV: ${this.iv}.`);
                }
                else {
                    log_1.default.error('Unknown site.');
                }
            }
            else {
                this.isEncrypted = false;
                // Not encrypted
                if (this.m3u8Path.includes('freshlive')) {
                    // FreshTV
                    log_1.default.info('Site comfirmed: FreshTV.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/freshtv'));
                    this.prefix = parser.default.prefix;
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
                        filename: chunk.match(/\/([^\/]+?\.ts)/)[1]
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
                this.m3u8 = yield m3u8_1.loadM3U8(this.m3u8Path);
                if (!this.isStarted) {
                    this.isStarted = true;
                    this.checkQueue();
                }
                yield system_1.sleep(Math.min(5000, this.m3u8.getChunkLength() * 1000));
            }
        });
    }
    handleTask(task) {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            log_1.default.debug(`Downloading ${task.filename}`);
            try {
                yield media_1.download(task.url, path.resolve(this.tempPath, `./${task.filename}`));
                log_1.default.debug(`Downloading ${task.filename} succeed.`);
                if (this.isEncrypted) {
                    yield media_1.decrypt(path.resolve(this.tempPath, `./${task.filename}`), path.resolve(this.tempPath, `./${task.filename}`) + '.decrypt', this.key, this.iv);
                    log_1.default.debug(`Decrypting ${task.filename} succeed`);
                }
                resolve();
            }
            catch (e) {
                log_1.default.info(`Downloading or decrypting ${task.filename} failed. Retry later.`);
                reject(e);
            }
        }));
    }
    checkQueue() {
        if (this.chunks.length > 0 && this.runningThreads < this.threads) {
            const task = this.chunks.shift();
            this.runningThreads++;
            this.handleTask(task).then(() => {
                this.finishedChunks++;
                this.runningThreads--;
                log_1.default.info(`Proccessing ${task.filename} finished. (${this.finishedChunks} / unknown | Avg Speed: ${this.calculateSpeedByChunk()}chunks/s or ${this.calculateSpeedByRatio()}x)`);
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
            log_1.default.info(`${this.finishedChunks} chunks downloaded. Start merging chunks.`);
            media_1.mergeVideo(this.outputFileList, this.outputPath).then(() => __awaiter(this, void 0, void 0, function* () {
                log_1.default.info('End of merging.');
                log_1.default.info('Starting cleaning temporary files.');
                yield system_1.exec(`rm -rf ${this.tempPath}`);
                log_1.default.info(`All finished. Check your file at [${this.outputPath}] .`);
            }));
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