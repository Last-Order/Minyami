/**
 * M3U8 Parser
 */
export default class M3U8 {
    m3u8Content: string;
    isEncrypted: boolean;
    isEnd: boolean;
    chunks: string[];
    constructor(m3u8: string);
    /**
     * 解析基本属性
     */
    parse(): void;
    /**
     * 获得加密Key
     */
    getKey(): string;
    /**
     * 获得加密IV
     */
    getIV(): string;
}
