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
const axios_1 = require("axios");
const log_1 = require("../utils/log");
const m3u8_1 = require("./m3u8");
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
            this.m3u8 = new m3u8_1.default(m3u8Content);
        });
    }
}
;
exports.default = Downloader;
//# sourceMappingURL=basedownloader.js.map