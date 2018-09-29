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
const media_1 = require("../../utils/media");
class Parser {
    static parse({ key = '', iv = '', options }) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield media_1.requestRaw(key, options.proxy, {
                responseType: 'arraybuffer'
            });
            const hexKey = Array.from(new Uint8Array(response.data)).map(i => i.toString(16).length === 1 ? '0' + i.toString(16) : i.toString(16)).join('');
            const sequenceId = options.m3u8.m3u8Content.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)[1];
            return {
                key: hexKey,
                iv: sequenceId,
                prefix: Parser.prefix
            };
        });
    }
}
Parser.prefix = '';
exports.default = Parser;
//# sourceMappingURL=bch.js.map