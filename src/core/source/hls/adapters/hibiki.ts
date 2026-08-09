import { buildFullUrl } from "../../../../utils/common";
import { SiteAdapterOptions, SiteAdapterResult } from "./types";

export function adaptHibiki({ key, playlist }: SiteAdapterOptions): SiteAdapterResult {
    if (!key) {
        throw new Error("To download Hibiki-Radio, you need to set a key manually");
    }
    const encryptionKeys: Record<string, string> = {};
    for (const keyUrl of playlist.encryptKeys) {
        encryptionKeys[buildFullUrl(playlist.playlistUrl, keyUrl)] = key;
    }
    return {
        encryptionKeys,
        keyResolver: async ({ keyUrls, playlistUrl }) =>
            Object.fromEntries(keyUrls.map((keyUrl) => [buildFullUrl(playlistUrl, keyUrl), key])),
    };
}
