"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const log_1 = require("../../utils/log");
class Parser {
    static parse({ key = '', iv = '', options }) {
        if (!options.m3u8Url) {
            log_1.default.error('Missing m3u8 url for sonymusic.');
        }
        return {
            key,
            iv,
            prefix: ''
        };
    }
}
exports.default = Parser;
//# sourceMappingURL=sonymusic.js.map