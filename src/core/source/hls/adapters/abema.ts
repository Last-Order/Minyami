import { SiteAdapterOptions, SiteAdapterResult } from "./types";

export function adaptAbema({ explicitKeys, playlist }: SiteAdapterOptions): SiteAdapterResult {
    const key = explicitKeys[0];
    if (!key) {
        throw new Error("To download AbemaTV, you need to set a key manually");
    }
    const encryptionKeys: Record<string, string> = {};
    for (const keyReference of playlist.keys) {
        encryptionKeys[keyReference.id] = key;
    }
    return {
        encryptionKeys,
        keyResolver: async ({ keys }) => Object.fromEntries(keys.map((keyReference) => [keyReference.id, key])),
        segments: playlist.segments.filter(
            (segment) => !segment.url.includes("/tspgsl/") && !segment.url.includes("/tsad/")
        ),
    };
}
