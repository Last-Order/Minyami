import { ParserOptions, ParserResult } from "./types";

export default class Parser {
    static parse({
        downloader
    }: ParserOptions): ParserResult {
        downloader.onChunkNaming = (chunk) => {
            const chunkIdMatch = chunk.url.match(/\/(\d+?)\/goap/);
            if (chunkIdMatch) {
                return chunkIdMatch[1];
            } else {
                throw new Error(`Bad chunk url: ${chunk.url}`);
            }
        }
        return {};
    }
}