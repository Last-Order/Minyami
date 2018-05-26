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
const fs = require("fs");
const log_1 = require("../utils/log");
const media_1 = require("../utils/media");
const axios_1 = require("axios");
const system_1 = require("../utils/system");
const path = require('path');
class Downloader {
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(m3u8Path, { threads, output } = {
        threads: 5
    }) {
        this.outputPath = './output.mkv';
        this.finishedChunks = 0;
        this.threads = 5;
        this.runningThreads = 0;
        this.isEncrypted = true;
        if (threads) {
            this.threads = threads;
        }
        if (output) {
            this.outputPath = output;
        }
        this.m3u8Path = m3u8Path;
        this.tempPath = path.resolve(__dirname, '../../temp');
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            let m3u8Content;
            if (!fs.existsSync(this.tempPath)) {
                fs.mkdirSync(this.tempPath);
            }
            if (this.m3u8Path.startsWith('http')) {
                log_1.default.info('Start fetching M3U8 file.');
                try {
                    const response = yield axios_1.default.get(this.m3u8Path);
                    log_1.default.info('M3U8 file fetched.');
                    m3u8Content = response.data;
                }
                catch (e) {
                    log_1.default.error('Fail to fetch M3U8 file.');
                }
            }
            else {
                // is a local file path
                if (!fs.existsSync(this.m3u8Path)) {
                    log_1.default.error(`File '${this.m3u8Path}' not found.`);
                }
                log_1.default.info('Loading M3U8 file.');
                m3u8Content = fs.readFileSync(this.m3u8Path).toString();
            }
            this.m3u8Content = m3u8Content;
            // parse m3u8
            if (m3u8Content.match(/EXT-X-KEY:METHOD=AES-128,URI="(.+)"/) !== null) {
                // Encrypted
                this.isEncrypted = true;
                const key = m3u8Content.match(/EXT-X-KEY:METHOD=AES-128,URI="(.+)"/)[1];
                const iv = m3u8Content.match(/IV=0x(.+)/)[1];
                if (!key || !iv) {
                    log_1.default.error('Unsupported site.');
                }
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
            }
            else {
                // Not encrypted
                this.isEncrypted = false;
                if (this.m3u8Path.includes('freshlive')) {
                    // FreshTV
                    const parser = yield Promise.resolve().then(() => require('./parsers/freshtv'));
                    this.prefix = parser.default.prefix;
                }
            }
        });
    }
    download() {
        return __awaiter(this, void 0, void 0, function* () {
            log_1.default.info(`Start downloading with ${this.threads} thread(s).`);
            this.chunks = this.m3u8Content.match(/(.+\.ts.*)/ig).map(chunk => {
                return {
                    url: this.prefix + chunk,
                    filename: chunk.match(/\/([^\/]+?\.ts)/)[1]
                };
            });
            this.totalChunks = this.chunks.length;
            this.outputFileList = this.chunks.map(chunk => {
                if (this.isEncrypted) {
                    return path.resolve(this.tempPath, `./${chunk.filename}.decrypt`);
                }
                else {
                    return path.resolve(this.tempPath, `./${chunk.filename}`);
                }
            });
            this.checkQueue();
        });
    }
    handleTask(task) {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            log_1.default.debug(`Downloading ${task.filename}`);
            try {
                yield media_1.download(task.url, path.resolve(this.tempPath, `./${task.filename}`));
                log_1.default.debug(`Download ${task.filename} succeed.`);
                if (this.isEncrypted) {
                    yield media_1.decrypt(path.resolve(this.tempPath, `./${task.filename}`), path.resolve(this.tempPath, `./${task.filename}`) + '.decrypt', this.key, this.iv);
                    log_1.default.debug(`Decrypt ${task.filename} succeed`);
                }
                resolve();
            }
            catch (e) {
                log_1.default.info(`Download or decrypt ${task.filename} failed. Retry later.`);
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
                log_1.default.info(`Proccess ${task.filename} finished. (${this.finishedChunks} / ${this.totalChunks} or ${(this.finishedChunks / this.totalChunks * 100).toFixed(2)}%)`);
                this.checkQueue();
            }).catch(e => {
                console.error(e);
                this.runningThreads--;
                this.chunks.push(task);
                this.checkQueue();
            });
            this.checkQueue();
        }
        if (this.chunks.length === 0 && this.runningThreads === 0) {
            log_1.default.info('All chunks downloaded. Start merging chunks.');
            media_1.mergeVideo(this.outputFileList, this.outputPath).then(() => __awaiter(this, void 0, void 0, function* () {
                log_1.default.info('End of merging.');
                log_1.default.info('Starting cleaning temporary files.');
                yield system_1.exec(`rm -rf ${this.tempPath}`);
                log_1.default.info(`All finished. Check your file at [${this.outputPath}] .`);
            }));
        }
    }
}
exports.default = Downloader;
//# sourceMappingURL=downloader.js.map