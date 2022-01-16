import { URL } from "url";
import { ParserOptions, ParserResult } from "./types";

export default class Parser {
    static parse({ downloader }: ParserOptions): ParserResult {
        downloader.setOnChunkNaming((chunk) => {
            const pathname = new URL(chunk.url).pathname.split("/");
            return `${pathname[pathname.length - 2]}_${pathname[pathname.length - 1]}`;
        });
        return {};
    }
}
