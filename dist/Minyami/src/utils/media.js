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
const fs = require('fs');
/**
 * 合并视频文件
 * @param fileList 文件列表
 * @param output 输出路径
 */
function mergeVideo(fileList = [], output = "output.mkv") {
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
//# sourceMappingURL=media.js.map