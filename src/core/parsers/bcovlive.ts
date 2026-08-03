import { ParserOptions, ParserResult } from "./types";

export function parseBcovLive(_options: ParserOptions): ParserResult {
    return { dropChunksOnMaxRetries: true };
}
