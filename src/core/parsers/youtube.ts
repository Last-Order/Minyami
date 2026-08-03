import { ParserOptions, ParserResult } from "./types";

export function parseYoutube(_options: ParserOptions): ParserResult {
    return {
        chunkNamer: (chunk) => {
            const match = chunk.url.match(/\/(\d+?)\/goap/);
            if (!match) {
                throw new Error(`Bad chunk url: ${chunk.url}`);
            }
            return match[1];
        },
    };
}
