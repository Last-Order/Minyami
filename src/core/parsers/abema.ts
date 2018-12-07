import { ParserOptions, ParserResult } from "./types";

export default class Parser {
    static prefix = '';
    static parse({
        downloader
    }: ParserOptions): ParserResult {
        if (!downloader.key) {
            throw new Error('To download AbemaTV, you need to set a key manually');
        }
        downloader.saveEncryptionKey(downloader.m3u8.key, downloader.key);
        return {};
    }
}