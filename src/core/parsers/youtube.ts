import { ParserOptions, ParserResult } from "./types";

export function parseYoutube(_options: ParserOptions): ParserResult {
    return {
        itemNamer: (item) => {
            const match = item.url.match(/\/(\d+?)\/goap/);
            if (!match) {
                throw new Error(`Bad item url: ${item.url}`);
            }
            return match[1];
        },
    };
}
