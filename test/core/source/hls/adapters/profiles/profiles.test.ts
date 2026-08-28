import { describe, expect, jest, test } from "@jest/globals";
import { runWithAbortSignal } from "@/utils/abort";
import { normalizeDownloaderConfig } from "@/core/download/config";
import { DownloadHttpClient } from "@/core/download/infrastructure/http_client";
import { KeyStore } from "@/core/download/infrastructure/key_store";
import { fmp4HLSProfile } from "@/core/source/hls/adapters/profiles/fmp4";
import { packedAacHLSProfile } from "@/core/source/hls/adapters/profiles/packed_aac";
import { mpegTsHLSProfile } from "@/core/source/hls/adapters/profiles/mpeg_ts";
import {
    HLSKeyReferenceKind,
    HLSMediaPlaylist,
    HLSPlaylistKind,
    HLSSegmentKind,
} from "@/core/source/hls/playlist/parser";
import { createProtectedInitialization } from "../../../../../helpers/isobmff";

describe("MPEG-TS HLS profile", () => {
    test("the MPEG-TS profile resolves AES-128 sequence IVs before publishing items", async () => {
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
        const plan = await mpegTsHLSProfile.prepare({ playlist, explicitKeys: [{ key: explicitKey }], http });

        await withSignal(() => plan.ensureKeys(playlist, context));

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
        const plan = await mpegTsHLSProfile.prepare({ playlist, explicitKeys: [{ key: explicitKey }], http });

        await withSignal(() => plan.ensureKeys(playlist, context));

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

describe("Packed AAC HLS profile", () => {
    test("publishes the Packed AAC SAMPLE-AES scheme and AAC container", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const context = { http, keys: new KeyStore() };
        const key = {
            kind: HLSKeyReferenceKind.External,
            id: "skd://packed-audio",
            uri: "skd://packed-audio",
        } as const;
        const playlist: HLSMediaPlaylist = {
            kind: HLSPlaylistKind.Media,
            segments: [
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/protected.aac",
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
        const explicitKey = "33".repeat(16);
        const plan = await packedAacHLSProfile.prepare({ playlist, explicitKeys: [{ key: explicitKey }], http });

        await withSignal(() => plan.ensureKeys(playlist, context));

        expect(plan.container).toMatchObject({ name: "AAC", extension: "aac" });
        expect(context.keys.get(key.id)).toBe(explicitKey);
        expect(plan.toDownloadItem(playlist.segments[0])).toEqual({
            url: "https://media.example/protected.aac",
            kind: "media",
            duration: 2,
            encryption: { scheme: "packed-aac-sample-aes", keyId: key.id, iv: "01" },
        });
    });
});

describe("fMP4 HLS profile", () => {
    test("maps multiple AES-128 keys to key URIs in first-seen order", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const request = jest.spyOn(http, "request");
        const context = { http, keys: new KeyStore() };
        const firstKey = {
            kind: HLSKeyReferenceKind.Http,
            id: "https://media.example/first.key",
            url: "https://media.example/first.key",
        } as const;
        const secondKey = {
            kind: HLSKeyReferenceKind.Http,
            id: "https://media.example/second.key",
            url: "https://media.example/second.key",
        } as const;
        const playlist: HLSMediaPlaylist = {
            kind: HLSPlaylistKind.Media,
            segments: [
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/0.m4s",
                    duration: 2,
                    sequenceId: 0,
                    encryption: { method: "AES-128", key: firstKey },
                },
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/1.m4s",
                    duration: 2,
                    sequenceId: 1,
                    encryption: { method: "AES-128", key: secondKey },
                },
            ],
            keys: [firstKey, secondKey],
            hasEndList: true,
            totalDuration: 4,
            averageSegmentDuration: 2,
        };
        const explicitKeys = [{ key: "44".repeat(16) }, { key: "55".repeat(16) }];
        const plan = await fmp4HLSProfile.prepare({ playlist, explicitKeys, http });

        await withSignal(() => plan.ensureKeys(playlist, context));

        expect(context.keys.get(firstKey.id)).toBe(explicitKeys[0].key);
        expect(context.keys.get(secondKey.id)).toBe(explicitKeys[1].key);
        expect(request).not.toHaveBeenCalled();
        expect(plan.toDownloadItem(playlist.segments[1]).encryption).toEqual({
            scheme: "aes-128-cbc",
            keyId: secondKey.id,
            iv: "1",
        });
    });

    test("maps one key to every protected track id without inspecting unrelated protection metadata", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        jest.spyOn(http, "request").mockResolvedValue({ data: createProtectedInitialization(7, "cenc") } as never);
        const context = { http, keys: new KeyStore() };
        const playlist = createFmp4SampleAesPlaylist();
        const explicitKey = "22".repeat(16);
        const plan = await fmp4HLSProfile.prepare({ playlist, explicitKeys: [{ key: explicitKey }], http });

        await withSignal(() => plan.ensureKeys(playlist, context));

        const keyId = `fmp4:${playlist.segments[0].initializationId}`;
        expect(context.keys.get(keyId)).toBe(explicitKey);
        expect(plan.toDownloadItem(playlist.segments[0])).toMatchObject({
            kind: "init",
            output: {
                replayablePrefix: { slot: "hls-map", identity: "init-a" },
                startsNewRun: true,
            },
            encryption: {
                scheme: "iso-bmff-sample-aes",
                operation: "initialization",
                keys: [{ selector: "7", keyId }],
            },
        });
        expect(plan.toDownloadItem(playlist.segments[1])).toMatchObject({
            kind: "media",
            output: { requiredPrefixes: [{ slot: "hls-map", identity: "init-a" }] },
            encryption: {
                scheme: "iso-bmff-sample-aes",
                operation: "fragment",
                keys: [{ selector: "7", keyId }],
            },
        });
    });

    test("uses canonical KIDs when multiple fMP4 keys are supplied", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        jest.spyOn(http, "request").mockResolvedValue({ data: Buffer.from("opaque fragments info") } as never);
        const context = { http, keys: new KeyStore() };
        const playlist = createFmp4SampleAesPlaylist();
        const firstKid = "00112233-4455-6677-8899-aabbccddeeff";
        const secondKid = "ffeeddccbbaa99887766554433221100";
        const plan = await fmp4HLSProfile.prepare({
            playlist,
            explicitKeys: [
                { kid: firstKid, key: "11".repeat(16) },
                { kid: secondKid, key: "22".repeat(16) },
            ],
            http,
        });

        await withSignal(() => plan.ensureKeys(playlist, context));

        expect(plan.toDownloadItem(playlist.segments[1]).encryption).toMatchObject({
            scheme: "iso-bmff-sample-aes",
            operation: "fragment",
            keys: [
                {
                    selector: "00112233445566778899aabbccddeeff",
                    keyId: "cenc:kid:00112233445566778899aabbccddeeff",
                },
                {
                    selector: secondKid,
                    keyId: `cenc:kid:${secondKid}`,
                },
            ],
        });
    });

    test("rejects missing explicit keys before publishing items", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const playlist = createFmp4SampleAesPlaylist();
        const context = { http, keys: new KeyStore() };
        const noKeyPlan = await fmp4HLSProfile.prepare({ playlist, explicitKeys: [], http });

        await expect(withSignal(() => noKeyPlan.ensureKeys(playlist, context))).rejects.toThrow(
            "This HLS content is protected. Provide an explicit decryption key."
        );
    });
});

function createFmp4SampleAesPlaylist(): HLSMediaPlaylist {
    const key = {
        kind: HLSKeyReferenceKind.External,
        id: "skd://asset",
        uri: "skd://asset",
    } as const;
    return {
        kind: HLSPlaylistKind.Media,
        segments: [
            {
                kind: HLSSegmentKind.Initialization,
                initializationId: "init-a",
                url: "https://media.example/init.mp4",
            },
            {
                kind: HLSSegmentKind.Media,
                initializationId: "init-a",
                url: "https://media.example/0.m4s",
                duration: 2,
                sequenceId: 0,
                encryption: {
                    method: "SAMPLE-AES",
                    key,
                    keyFormat: "com.apple.streamingkeydelivery",
                },
            },
        ],
        keys: [key],
        hasEndList: true,
        totalDuration: 2,
        averageSegmentDuration: 2,
    };
}

function withSignal<T>(operation: () => T): T {
    return runWithAbortSignal(new AbortController().signal, operation);
}
