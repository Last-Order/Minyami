import { ParserOptions, ParserResult } from "./types";
import CommonUtils from '../../utils/common';

export default class Parser {
    static prefix = '';
    static parse({
        downloader
    }: ParserOptions): ParserResult {
        if (!downloader.key) {
            throw new Error('To download Hibiki-Radio, you need to set a key manually');
        }
        downloader.saveEncryptionKey(
            CommonUtils.buildFullUrl(downloader.m3u8.m3u8Url, downloader.m3u8.key), 
            downloader.key
        );
        return {};
    }
}