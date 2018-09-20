/**
 * M3U8 Parser
 */

export default class M3U8 {
    m3u8Content: string;
    isEncrypted: boolean;
    isEnd: boolean;
    chunks: string[];

    constructor(m3u8: string) {
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