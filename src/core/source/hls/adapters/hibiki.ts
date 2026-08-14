import { SiteAdapterOptions, SiteAdapterResult } from "./types";

export function adaptHibiki({ explicitKeys, playlist }: SiteAdapterOptions): SiteAdapterResult {
    const key = explicitKeys[0];
    if (!key) {
        throw new Error("To download Hibiki-Radio, you need to set a key manually");
    }
    const encryptionKeys: Record<string, string> = {};
    for (const keyReference of playlist.keys) {
        encryptionKeys[keyReference.id] = key;
    }
    return {
        encryptionKeys,
        keyResolver: async ({ keys }) => Object.fromEntries(keys.map((keyReference) => [keyReference.id, key])),
    };
}
