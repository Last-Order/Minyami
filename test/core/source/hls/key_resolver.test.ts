import { describe, expect, jest, test } from "@jest/globals";
import { normalizeDownloaderConfig } from "@/core/download/config";
import { DownloadHttpClient } from "@/core/download/infrastructure/http_client";
import { KeyStore } from "@/core/download/infrastructure/key_store";
import { createHLSKeyResolver } from "@/core/source/hls/key_resolver";
import {
    HLSHttpKeyReference,
    HLSMediaPlaylist,
    HLSPlaylistKind,
    HLSSegmentKind,
} from "@/core/source/hls/playlist/parser";

describe("HLSKeyResolver", () => {
    test("keeps ordered explicit-key assignments stable across playlist refreshes", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const request = jest.spyOn(http, "request");
        const keys = new KeyStore();
        const first = createKeyReference("first");
        const second = createKeyReference("second");
        const third = createKeyReference("third");
        const explicitKeys = ["11", "22", "33"].map((byte) => ({ key: byte.repeat(16) }));
        const resolver = createHLSKeyResolver(explicitKeys, http);

        await resolver.ensure(createPlaylist([first, second]), { http, keys }, "AES-128");
        await resolver.ensure(createPlaylist([second, third]), { http, keys }, "AES-128");

        expect(keys.get(first.id)).toBe(explicitKeys[0].key);
        expect(keys.get(second.id)).toBe(explicitKeys[1].key);
        expect(keys.get(third.id)).toBe(explicitKeys[2].key);
        expect(request).not.toHaveBeenCalled();
    });

    test("uses one explicit key for every referenced URI", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const request = jest.spyOn(http, "request");
        const keys = new KeyStore();
        const references = [createKeyReference("first"), createKeyReference("second")];
        const explicitKey = "44".repeat(16);
        const resolver = createHLSKeyResolver([{ key: explicitKey }], http);

        await resolver.ensure(createPlaylist(references), { http, keys }, "AES-128");

        expect(references.map((key) => keys.get(key.id))).toEqual([explicitKey, explicitKey]);
        expect(request).not.toHaveBeenCalled();
    });
});

function createKeyReference(name: string): HLSHttpKeyReference {
    const url = `https://media.example/${name}.key`;
    return { kind: "http", id: url, url };
}

function createPlaylist(references: readonly HLSHttpKeyReference[]): HLSMediaPlaylist {
    return {
        kind: HLSPlaylistKind.Media,
        segments: references.map((key, sequenceId) => ({
            kind: HLSSegmentKind.Media,
            url: `https://media.example/${sequenceId}.m4s`,
            duration: 2,
            sequenceId,
            encryption: { method: "AES-128" as const, key },
        })),
        keys: references,
        hasEndList: true,
        totalDuration: references.length * 2,
        averageSegmentDuration: 2,
    };
}
