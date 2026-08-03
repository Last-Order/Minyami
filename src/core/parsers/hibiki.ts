import { buildFullUrl } from "../../utils/common";
import { ParserOptions, ParserResult } from "./types";

export function parseHibiki({ key, playlist }: ParserOptions): ParserResult {
    if (!key) {
        throw new Error("To download Hibiki-Radio, you need to set a key manually");
    }
    const encryptionKeys: Record<string, string> = {};
    for (const keyUrl of playlist.encryptKeys) {
        encryptionKeys[buildFullUrl(playlist.m3u8Url, keyUrl)] = key;
    }
    return {
        encryptionKeys,
        keyResolver: async ({ keyUrls, playlistUrl }) =>
            Object.fromEntries(keyUrls.map((keyUrl) => [buildFullUrl(playlistUrl, keyUrl), key])),
    };
}
