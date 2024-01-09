import { ParserOptions, ParserResult } from "./types";

export default class Parser {
    static prefix = "";
    static parse({ downloader }: ParserOptions): ParserResult {
        downloader._internal_dropChunksInArchiveMode = true;
        return {};
    }
}
