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
class Downloader {
    /**
     *
     * @param path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(path, { threads } = {
        threads: 5
    }) {
        this.threads = threads;
        this.m3u8Path = path;
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!fs.existsSync('./temp')) {
                fs.mkdirSync('./temp');
            }
            if (this.m3u8Path.startsWith('http')) {
                //const response = await axios.get(this.m3u8Path);
                //console.log(response);
            }
            else {
                // is a local file path
                if (!fs.existsSync(this.m3u8Path)) {
                    log_1.default.error(`File '${this.m3u8Path}' not found.`);
                }
            }
        });
    }
}
exports.default = Downloader;
//# sourceMappingURL=downloader.js.map