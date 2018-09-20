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
const log_1 = require("../utils/log");
const media_1 = require("../utils/media");
const system_1 = require("../utils/system");
const downloader_1 = require("./downloader");
const path = require('path');
class ArchiveDownloader extends downloader_1.default {
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
        this.runningThreads = 0;
    }
    download() {
        return __awaiter(this, void 0, void 0, function* () {
            this.startedAt = new Date().valueOf();
            process.on("SIGINT", () => __awaiter(this, void 0, void 0, function* () {
                yield this.clean();
                process.exit();
            }));
            // parse m3u8
            if (this.m3u8.isEncrypted) {
                // Encrypted
                const key = this.m3u8.getKey();
                const iv = this.m3u8.getIV();
                if (key.startsWith('abemafresh')) {
                    log_1.default.info('Site comfirmed: FreshTV.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/freshtv'));
                    const parseResult = parser.default.parse({
                        key,
                        iv
                    });
                    [this.key, this.iv, this.prefix] = [parseResult.key, parseResult.iv, parseResult.prefix];
                    log_1.default.info(`Key: ${this.key}; IV: ${this.iv}.`);
                }
                else if (key.startsWith('abematv-license')) {
                    log_1.default.info('Site comfirmed: AbemaTV.');
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
                else if (this.m3u8Path.includes('bchvod')) {
                    log_1.default.info('Site comfirmed: B-ch.');
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
                        log_1.default.info(`Key: ${this.key}; IV: ${this.iv}.`);
                    }
                    catch (e) {
                        yield this.clean();
                        log_1.default.error('Fail to retrieve the key from server.');
                    }
                }
                else {
                    yield this.clean();
                    log_1.default.error('Unsupported site.');
                }
            }
            else {
                // Not encrypted
                if (this.m3u8Path.includes('freshlive')) {
                    // FreshTV
                    log_1.default.info('Site comfirmed: FreshTV.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/freshtv'));
                    this.prefix = parser.default.prefix;
                }
                else if (this.m3u8Path.includes('openrec')) {
                    // Openrec
                    log_1.default.info('Site comfirmed: OPENREC.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/openrec'));
                    const parseResult = parser.default.parse({
                        options: {
                            m3u8Url: this.m3u8Path
                        }
                    });
                    this.prefix = parseResult.prefix;
                }
                else if (this.m3u8Path.includes('brightcove')) {
                    log_1.default.info('Site comfirmed: Sony Music.');
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
                    log_1.default.info('Site comfirmed: NicoNico.');
                    log_1.default.info('请保持播放页面不要关闭');
                    log_1.default.info('Please do not close the video page.');
                    const parser = yield Promise.resolve().then(() => require('./parsers/nico'));
                    const parseResult = parser.default.parse({
                        options: {
                            m3u8Url: this.m3u8Path,
                            m3u8: this.m3u8
                        }
                    });
                    this.prefix = parseResult.prefix;
                    this.m3u8 = parseResult.m3u8;
                }
                else {
                    yield this.clean();
                    log_1.default.error('Unsupported site.');
                }
            }
            log_1.default.info(`Start downloading with ${this.threads} thread(s).`);
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
        const remainingTimeInSeconds = Math.round(((usedTime / this.finishedChunks * this.totalChunks) - usedTime) / 1000);
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
            this.runningThreads++;
            this.handleTask(task).then(() => {
                this.finishedChunks++;
                this.runningThreads--;
                log_1.default.info(`Proccessing ${task.filename} finished. (${this.finishedChunks} / ${this.totalChunks} or ${(this.finishedChunks / this.totalChunks * 100).toFixed(2)}% | Avg Speed: ${this.calculateSpeedByChunk()} chunks/s or ${this.calculateSpeedByRatio()}x | ETA: ${this.getETA()})`);
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
            log_1.default.info('All chunks downloaded. Start merging chunks.');
            const muxer = this.nomux ? media_1.mergeVideoNew : media_1.mergeVideo;
            muxer(this.outputFileList, this.outputPath).then(() => __awaiter(this, void 0, void 0, function* () {
                log_1.default.info('End of merging.');
                log_1.default.info('Starting cleaning temporary files.');
                yield system_1.deleteDirectory(this.tempPath);
                log_1.default.info(`All finished. Check your file at [${this.outputPath}] .`);
            })).catch(e => {
                console.log(e);
                log_1.default.error('Fail to merge video. Please merge video chunks manually.');
            });
        }
    }
}
exports.default = ArchiveDownloader;
//# sourceMappingURL=archive.js.map