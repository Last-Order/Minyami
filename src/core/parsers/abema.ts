import { ParserOptions, ParserResult } from "./types";
import CommonUtils from "../../utils/common";

export default class Parser {
    static prefix = "";
    static parse({ downloader }: ParserOptions): ParserResult {
        if (!downloader.key) {
            throw new Error("To download AbemaTV, you need to set a key manually");
        }
        for (const key of downloader.m3u8.encryptKeys) {
            downloader.saveEncryptionKey(CommonUtils.buildFullUrl(downloader.m3u8.m3u8Url, key), downloader.key);
        }
        downloader.m3u8.chunks = downloader.m3u8.chunks.filter((chunk) => {
            return !chunk.url.includes("/tspgsl/") && !chunk.url.includes("/tsad/");
        });
        return {};
    }
}
