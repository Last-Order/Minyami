import { ParserOptions, ParserResult } from "./types";

export default class Parser {
    static parse({
        downloader
    }: ParserOptions): ParserResult {
        downloader.onChunkNaming = (chunk) => {
            return chunk.url.match(/\/(\d+?)\/goap/)[1];
        }
        return {};
    }
}