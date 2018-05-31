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
const m3u8_1 = require("../utils/m3u8");
class Downloader {
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(m3u8Path, { threads, output, key } = {
        threads: 5
    }) {
        this.outputPath = './output.mkv';
        this.threads = 5;
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