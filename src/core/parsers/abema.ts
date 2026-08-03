import { buildFullUrl } from "../../utils/common";
import { ParserOptions, ParserResult } from "./types";

export function parseAbema({ key, playlist }: ParserOptions): ParserResult {
    if (!key) {
        throw new Error("To download AbemaTV, you need to set a key manually");
    }
    const encryptionKeys: Record<string, string> = {};
    for (const keyUrl of playlist.encryptKeys) {
        encryptionKeys[buildFullUrl(playlist.m3u8Url, keyUrl)] = key;
    }
    return {
        encryptionKeys,
        keyResolver: async ({ keyUrls, playlistUrl }) =>
            Object.fromEntries(keyUrls.map((keyUrl) => [buildFullUrl(playlistUrl, keyUrl), key])),
        chunks: playlist.chunks.filter((chunk) => !chunk.url.includes("/tspgsl/") && !chunk.url.includes("/tsad/")),
    };
}
