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
const system_1 = require("./system");
const axios_1 = require("axios");
const fs = require("fs");
const SocksProxyAgent = require('socks-proxy-agent');
/**
 * 合并视频文件
 * @param fileList 文件列表
 * @param output 输出路径
 */
function mergeVideo(fileList = [], output = "./output.mkv") {
    return __awaiter(this, void 0, void 0, function* () {
        if (fileList.length === 0) {
            return;
        }
        fileList = fileList.map((file, index) => {
            return index === 0 ? file : `+${file}`;
        });
        const parameters = fileList.concat([
            "-o",
            output,
            "-q"
        ]);
        const tempFilename = `temp_${new Date().valueOf()}.json`;
        fs.writeFileSync(`./${tempFilename}`, JSON.stringify(parameters));
        yield system_1.exec(`mkvmerge @${tempFilename}`);
        fs.unlinkSync(`./${tempFilename}`);
    });
}
exports.mergeVideo = mergeVideo;
function mergeVideoNew(fileList = [], output = "./output.ts") {
    return __awaiter(this, void 0, void 0, function* () {
        if (fileList.length === 0) {
            return;
        }
        // create output file
        const fd = fs.openSync(output, 'w');
        fs.closeSync(fd);
        for (const file of fileList) {
            fs.appendFileSync(output, fs.readFileSync(file));
        }
    });
}
exports.mergeVideoNew = mergeVideoNew;
/**
 * 下载文件
 * @param url
 * @param path
 */
function download(url, path, proxy = undefined) {
    return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield axios_1.default({
                url,
                method: 'GET',
                responseType: 'stream',
                timeout: 60000,
                httpsAgent: proxy ? new SocksProxyAgent(`socks5://${proxy.host}:${proxy.port}`) : undefined,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36'
                }
            });
            response.data.pipe(fs.createWriteStream(path));
            response.data.on('end', () => {
                resolve();
            });
        }
        catch (e) {
            reject(e);
        }
    }));
}
exports.download = download;
/**
 * Raw Request
 * @param url
 * @param proxy
 */
function requestRaw(url, proxy = undefined, options = {}) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield axios_1.default(Object.assign({ url, method: 'GET', responseType: 'stream', timeout: 60000, httpsAgent: proxy ? new SocksProxyAgent(`socks5://${proxy.host}:${proxy.port}`) : undefined, headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36'
            } }, options));
    });
}
exports.requestRaw = requestRaw;
/**
 * 解密文件
 * @param input
 * @param output
 * @param key
 * @param iv
 */
function decrypt(input, output, key, iv) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield system_1.exec(`openssl aes-128-cbc -d -in "${input}" -out "${output}" -K "${key}" -iv "${iv}"`);
    });
}
exports.decrypt = decrypt;
//# sourceMappingURL=media.js.map