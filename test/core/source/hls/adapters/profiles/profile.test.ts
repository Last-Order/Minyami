import { describe, expect, test } from "@jest/globals";
import { normalizeDownloaderConfig } from "../../../../../../src/core/download/config";
import { DownloadHttpClient } from "../../../../../../src/core/download/infrastructure/http_client";
import { KeyStore } from "../../../../../../src/core/download/infrastructure/key_store";
import { standardHLSProfile } from "../../../../../../src/core/source/hls/adapters/profiles/standard";
import {
    HLSKeyReferenceKind,
    HLSMediaPlaylist,
    HLSPlaylistKind,
    HLSSegmentKind,
} from "../../../../../../src/core/source/hls/parser";

describe("standard HLS profile", () => {
    test("the standard profile resolves AES-128 sequence IVs before publishing items", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const context = { http, keys: new KeyStore() };
        const key = {
            kind: HLSKeyReferenceKind.Http,
            id: "https://media.example/key.bin",
            url: "https://media.example/key.bin",
        } as const;
        const playlist: HLSMediaPlaylist = {
            kind: HLSPlaylistKind.Media,
            segments: [
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/7.ts",
                    duration: 2,
                    sequenceId: 7,
                    encryption: { method: "AES-128", key },
                },
            ],
            keys: [key],
            hasEndList: true,
            totalDuration: 2,
            averageSegmentDuration: 2,
        };
        const explicitKey = "00".repeat(16);
        const plan = await standardHLSProfile.prepare({ playlist, explicitKeys: [{ key: explicitKey }], http });

        await plan.ensureKeys(playlist, context, new AbortController().signal);

        expect(context.keys.get(key.id)).toBe(explicitKey);
        expect(plan.toDownloadItem(playlist.segments[0])).toEqual({
            url: "https://media.example/7.ts",
            kind: "media",
            duration: 2,
            encryption: { scheme: "aes-128-cbc", keyId: key.id, iv: "7" },
        });
    });

    test("publishes the MPEG-TS SAMPLE-AES scheme and IV", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const context = { http, keys: new KeyStore() };
        const key = {
            kind: HLSKeyReferenceKind.External,
            id: "skd://asset",
            uri: "skd://asset",
        } as const;
        const playlist: HLSMediaPlaylist = {
            kind: HLSPlaylistKind.Media,
            segments: [
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/protected.ts",
                    duration: 2,
                    sequenceId: 1,
                    encryption: {
                        method: "SAMPLE-AES",
                        key,
                        iv: "01",
                        keyFormat: "com.apple.streamingkeydelivery",
                    },
                },
            ],
            keys: [key],
            hasEndList: true,
            totalDuration: 2,
            averageSegmentDuration: 2,
        };
        const explicitKey = "11".repeat(16);
        const plan = await standardHLSProfile.prepare({ playlist, explicitKeys: [{ key: explicitKey }], http });

        await plan.ensureKeys(playlist, context, new AbortController().signal);

        expect(context.keys.get(key.id)).toBe(explicitKey);
        expect(plan.toDownloadItem(playlist.segments[0])).toEqual({
            url: "https://media.example/protected.ts",
            kind: "media",
            duration: 2,
            encryption: { scheme: "mpeg-ts-sample-aes", keyId: key.id, iv: "01" },
        });

        const clearPlaylist: HLSMediaPlaylist = {
            ...playlist,
            segments: [
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/clear.ts",
                    duration: 2,
                    sequenceId: 2,
                },
            ],
            keys: [],
        };

        expect(plan.toDownloadItem(clearPlaylist.segments[0])).toEqual({
            url: "https://media.example/clear.ts",
            kind: "media",
            duration: 2,
        });
    });
});
