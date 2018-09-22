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
const system = require("../utils/system");
const media_1 = require("../utils/media");
class Downloader {
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(m3u8Path, { threads, output, key, verbose, nomux, retries, proxy } = {
        threads: 5
    }) {
        this.outputPath = './output.mkv'; // 输出目录
        this.threads = 5; // 并发数量
        this.verbose = false; // 调试输出
        this.nomux = false; // 仅合并分段不remux
        this.finishedChunksCount = 0; // 已完成的块数量
        this.retries = 1; // 重试数量
        this.timeout = 60000; // 超时时间
        this.proxy = '';
        this.proxyHost = '';
        this.proxyPort = 0;
        if (threads) {
            this.threads = threads;
        }
        if (nomux) {
            this.nomux = nomux;
            this.outputPath = 'output.ts';
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
        if (retries) {
            this.retries = retries;
        }
        if (proxy) {
            const splitedProxyString = proxy.split(':');
            this.proxy = proxy;
            this.proxyHost = splitedProxyString.slice(0, splitedProxyString.length - 1).join('');
            this.proxyPort = parseInt(splitedProxyString[splitedProxyString.length - 1]);
        }
        this.m3u8Path = m3u8Path;
        if (process.platform === "win32") {
            var rl = require("readline").createInterface({
                input: process.stdin,
                output: process.stdout
            });
            rl.on("SIGINT", function () {
                process.emit("SIGINT");
            });
        }
    }
    /**
     * 初始化 读取m3u8内容
     */
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.loadM3U8();
        });
    }
    loadM3U8() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                this.m3u8 = yield m3u8_1.loadM3U8(this.m3u8Path, this.retries, this.timeout, this.proxy ? { host: this.proxyHost, port: this.proxyPort } : undefined);
            }
            catch (e) {
                console.log(e);
                yield this.clean();
                log_1.default.error('Aborted due to critical error.');
            }
        });
    }
    /**
     * 退出前的清理工作
     */
    clean() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                log_1.default.info('Starting cleaning temporary files.');
                yield system.deleteDirectory(this.tempPath);
            }
            catch (e) {
                log_1.default.error('Fail to delete temporary directory.');
            }
        });
    }
    /**
     * 处理块下载任务
     * @param task 块下载任务
     */
    handleTask(task) {
        return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
            this.verbose && log_1.default.debug(`Downloading ${task.filename}`);
            try {
                yield media_1.download(task.url, path.resolve(this.tempPath, `./${task.filename}`), this.proxy ? { host: this.proxyHost, port: this.proxyPort } : undefined);
                this.verbose && log_1.default.debug(`Downloading ${task.filename} succeed.`);
                if (this.m3u8.isEncrypted) {
                    yield media_1.decrypt(path.resolve(this.tempPath, `./${task.filename}`), path.resolve(this.tempPath, `./${task.filename}`) + '.decrypt', this.key, this.iv);
                    this.verbose && log_1.default.debug(`Decrypting ${task.filename} succeed`);
                }
                resolve();
            }
            catch (e) {
                log_1.default.warning(`Downloading or decrypting ${task.filename} failed. Retry later.`);
                reject(e);
            }
        }));
    }
    /**
     * 计算以块计算的下载速度
     */
    calculateSpeedByChunk() {
        return (this.finishedChunksCount / Math.round((new Date().valueOf() - this.startedAt) / 1000)).toFixed(2);
    }
    /**
     * 计算以视频长度为基准下载速度倍率
     */
    calculateSpeedByRatio() {
        return (this.finishedChunksCount * this.m3u8.getChunkLength() / Math.round((new Date().valueOf() - this.startedAt) / 1000)).toFixed(2);
    }
}
;
exports.default = Downloader;
//# sourceMappingURL=downloader.js.map