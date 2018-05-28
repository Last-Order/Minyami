export interface ParserOptions {
    key: string;
    iv: string;
    options?: ParserAdditionalOptions;
}
export interface ParserAdditionalOptions {
    key: string;
}
export interface ParserResult {
    key: string;
    iv: string;
    prefix: string;
}
