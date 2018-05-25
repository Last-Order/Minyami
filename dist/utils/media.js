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
const fs = require('fs');
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
        const parameters = fileList.concat([
            "-o",
            output
        ]);
        fs.writeFileSync('./temp.json', JSON.stringify(parameters));
        yield system_1.exec('mkvmerge @temp.json');
        fs.unlinkSync('./temp.json');
    });
}
exports.mergeVideo = mergeVideo;
/**
 * 下载文件
 * @param url
 * @param path
 */
function download(url, path) {
    return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
        try {
            const response = yield axios_1.default({
                url,
                method: 'GET',
                responseType: 'stream',
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
 * 解密文件
 * @param input
 * @param output
 * @param key
 * @param iv
 */
function decrypt(input, output, key, iv) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield system_1.exec(`openssl aes-128-cbc -d -in '${input}' -out '${output}' -K "${key}" -iv "${iv}"`);
    });
}
exports.decrypt = decrypt;
//# sourceMappingURL=media.js.map