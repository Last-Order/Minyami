export interface ParserOptions {
    key: string;
    iv: string;
    options?: object;
}
export interface ParserResult {
    key: string;
    iv: string;
    prefix: string;
}
