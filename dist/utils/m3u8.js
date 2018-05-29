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
const fs = require('fs');
const m3u8_1 = require("../core/m3u8");
const log_1 = require("./log");
const axios_1 = require("axios");
function loadM3U8(path) {
    return __awaiter(this, void 0, void 0, function* () {
        let m3u8Content;
        if (path.startsWith('http')) {
            log_1.default.info('Start fetching M3U8 file.');
            try {
                const response = yield axios_1.default.get(path);
                log_1.default.info('M3U8 file fetched.');
                m3u8Content = response.data;
            }
            catch (e) {
                log_1.default.error('Fail to fetch M3U8 file.');
            }
        }
        else {
            // is a local file path
            if (!fs.existsSync(path)) {
                log_1.default.error(`File '${path}' not found.`);
            }
            log_1.default.info('Loading M3U8 file.');
            m3u8Content = fs.readFileSync(path).toString();
        }
        return new m3u8_1.default(m3u8Content);
    });
}
exports.loadM3U8 = loadM3U8;
//# sourceMappingURL=m3u8.js.map