/**
 * M3U8 Parser
 */

export interface M3U8Chunk {
    url: string;
    key?: string;
    iv?: string;
    sequenceId?: string;
}

export class M3U8ParseError extends Error {};

export default class M3U8 {
    m3u8Content: string;
    m3u8Url: string;
    isEncrypted: boolean;
    isEnd: boolean;
    key: string;
    iv: string;
    sequenceId: string;
    chunks: M3U8Chunk[] = [];
    properties: {};

    constructor(m3u8: string, m3u8Url: string = '') {
        this.m3u8Content = m3u8;
        this.m3u8Url = m3u8Url;
        this.parse();
    }

    /**
     * 解析基本属性
     */
    parse() {
        this.isEncrypted = this.m3u8Content.match(/EXT-X-KEY:METHOD=AES-128,URI="(.+)"/) !== null;
        this.isEnd = this.m3u8Content.match(/EXT-X-ENDLIST/) !== null;

        let inHeaderPart = true;
        let key: string, iv: string, sequenceId: string;
        for (const line of this.m3u8Content.split('\n')) {
            if (line.startsWith('#')) {
                // it is a m3u8 property
                if (line.startsWith('#EXT-X-KEY')) {
                    if (inHeaderPart) {
                        this.isEncrypted = true;
                        this.key = line.match(/EXT-X-KEY:METHOD=AES-128,URI="(.+)"/)[1];
                        this.iv = line.match(/IV=0x(.+)/) && line.match(/IV=0x(.+)/)[1];
                    } else {
                        key = line.match(/EXT-X-KEY:METHOD=AES-128,URI="(.+)"/)[1];
                        iv = line.match(/IV=0x(.+)/) && line.match(/IV=0x(.+)/)[1];
                    }
                }
                if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
                    if (inHeaderPart) {
                        this.sequenceId = line.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)[1];
                    } else {
                        sequenceId = line.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)[1];
                    }
                }
            } else {
                // normal video chunk
                inHeaderPart = false;
                const newChunk: M3U8Chunk = {
                    url: ''
                };
                if (line.startsWith('http')) {
                    newChunk.url = line;
                } else if (line.startsWith('/')) {
                    if (this.m3u8Url) {
                        newChunk.url = this.m3u8Url.match(/(htt(p|ps):\/\/.+?\/)/)[1] + line.slice(1);
                    } else {
                        throw new M3U8ParseError('Missing full url for m3u8.');
                    }
                } else {
                    if (this.m3u8Url) {
                        newChunk.url = this.m3u8Url.match(/(.+\/)/)[1] + line;
                    } else {
                        throw new M3U8ParseError('Missing full url for m3u8.');
                    }
                }
                if (key) {
                    newChunk.key = key;
                }
                if (iv) {
                    newChunk.iv = iv;
                }
                if (sequenceId) {
                    newChunk.sequenceId = sequenceId;
                }
                this.chunks.push(newChunk);
            }
        }
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