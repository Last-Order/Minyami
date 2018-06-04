export interface ParserOptions {
    key?: string;
    iv?: string;
    options?: ParserAdditionalOptions;
}
export interface ParserAdditionalOptions {
    key?: string;
    m3u8Url?: string;
}
export interface ParserResult {
    key: string;
    iv: string;
    prefix: string;
}
