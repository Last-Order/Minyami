"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Parser {
    static parse({ key = '', iv = '', options }) {
        if (!options.m3u8Url) {
            throw new Error('Missing m3u8 url for sonymusic.');
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