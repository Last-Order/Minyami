import M3U8 from "../m3u8";

export interface ParserOptions {
    key?: string;
    iv?: string;
    options?: ParserAdditionalOptions;
}

export interface ParserAdditionalOptions {
    key?: string;
    m3u8Url?: string;
    m3u8?: M3U8;
}

export interface ParserResult {
    key: string;
    iv: string;
    prefix: string;
    m3u8?: M3U8;
}