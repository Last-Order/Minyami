import { buildFullUrl } from "../../utils/common";
import { ParserOptions, ParserResult } from "./types";

export default class Parser {
    static prefix = "";
    static parse({ downloader }: ParserOptions): ParserResult {
        if (!downloader.key) {
            throw new Error("To download Hibiki-Radio, you need to set a key manually");
        }
        for (const key of downloader.m3u8.encryptKeys) {
            downloader.saveEncryptionKey(buildFullUrl(downloader.m3u8.m3u8Url, key), downloader.key);
        }
        return {};
    }
}
