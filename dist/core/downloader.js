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
const path = require('path');
const fs = require('fs');
const log_1 = require("../utils/log");
const m3u8_1 = require("../utils/m3u8");
const media_1 = require("../utils/media");
class Downloader {
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(m3u8Path, { threads, output, key, verbose } = {
        threads: 5
    }) {
        this.outputPath = './output.mkv';
        this.threads = 5;
        this.verbose = false;
        this.finishedChunks = 0;
        if (threads) {
            this.threads = threads;
        }
        if (output) {
            this.outputPath = output;
        }
        if (key) {
            this.key = key;
        }
        if (verbose) {
            this.verbose = verbose;
        }
        this.m3u8Path = m3u8Path;
        this.tempPath = path.resolve(__dirname, '../../temp');
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!fs.existsSync(this.tempPath)) {
                fs.mkdirSync(this.tempPath);
            }
            this.m3u8 = yield m3u8_1.loadM3U8(this.m3u8Path);
        });
    }
    handleTask(task) {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            this.verbose && log_1.default.debug(`Downloading ${task.filename}`);
            try {
                yield media_1.download(task.url, path.resolve(this.tempPath, `./${task.filename}`));
                this.verbose && log_1.default.debug(`Downloading ${task.filename} succeed.`);
                if (this.m3u8.isEncrypted) {
                    yield media_1.decrypt(path.resolve(this.tempPath, `./${task.filename}`), path.resolve(this.tempPath, `./${task.filename}`) + '.decrypt', this.key, this.iv);
                    this.verbose && log_1.default.debug(`Decrypting ${task.filename} succeed`);
                }
                resolve();
            }
            catch (e) {
                log_1.default.info(`Downloading or decrypting ${task.filename} failed. Retry later.`);
                reject(e);
            }
        }));
    }
    calculateSpeedByChunk() {
        return (this.finishedChunks / Math.round((new Date().valueOf() - this.startedAt) / 1000)).toFixed(2);
    }
    calculateSpeedByRatio() {
        return (this.finishedChunks * this.m3u8.getChunkLength() / Math.round((new Date().valueOf() - this.startedAt) / 1000)).toFixed(2);
    }
}
;
exports.default = Downloader;
//# sourceMappingURL=downloader.js.map