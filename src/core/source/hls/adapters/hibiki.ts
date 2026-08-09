import { SiteAdapterOptions, SiteAdapterResult } from "./types";

export function adaptHibiki({ key, playlist }: SiteAdapterOptions): SiteAdapterResult {
    if (!key) {
        throw new Error("To download Hibiki-Radio, you need to set a key manually");
    }
    const encryptionKeys: Record<string, string> = {};
    for (const keyUrl of playlist.encryptionKeyUrls) {
        encryptionKeys[keyUrl] = key;
    }
    return {
        encryptionKeys,
        keyResolver: async ({ keyUrls }) => Object.fromEntries(keyUrls.map((keyUrl) => [keyUrl, key])),
    };
}
