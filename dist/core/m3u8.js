"use strict";
/**
 * M3U8 Parser
 */
Object.defineProperty(exports, "__esModule", { value: true });
class M3U8 {
    constructor(m3u8) {
        this.m3u8Content = m3u8;
        this.parse();
    }
    /**
     * 解析基本属性
     */
    parse() {
        this.isEncrypted = this.m3u8Content.match(/EXT-X-KEY:METHOD=AES-128,URI="(.+)"/) !== null;
        this.isEnd = this.m3u8Content.match(/EXT-X-ENDLIST/) !== null;
        this.chunks = this.m3u8Content.match(/(.+\.ts.*)/ig);
    }
    /**
     * 获得加密Key
     */
    getKey() {
        return this.isEncrypted && this.m3u8Content.match(/EXT-X-KEY:METHOD=AES-128,URI="(.+)"/)[1];
    }
    /**
     * 获得加密IV
     */
    getIV() {
        return this.isEncrypted && this.m3u8Content.match(/IV=0x(.+)/) && this.m3u8Content.match(/IV=0x(.+)/)[1];
    }
    /**
     * 获得块长度
     */
    getChunkLength() {
        return parseFloat(this.m3u8Content.match(/#EXTINF:(.+),/)[1]);
    }
}
exports.default = M3U8;
//# sourceMappingURL=m3u8.js.map