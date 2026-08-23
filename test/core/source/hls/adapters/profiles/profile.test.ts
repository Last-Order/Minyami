import { describe, expect, jest, test } from "@jest/globals";
import { normalizeDownloaderConfig } from "../../../../../../src/core/download/config";
import { DownloadHttpClient } from "../../../../../../src/core/download/infrastructure/http_client";
import { KeyStore } from "../../../../../../src/core/download/infrastructure/key_store";
import { fmp4HLSProfile } from "../../../../../../src/core/source/hls/adapters/profiles/fmp4";
import { packedAacHLSProfile } from "../../../../../../src/core/source/hls/adapters/profiles/packed_aac";
import { standardHLSProfile } from "../../../../../../src/core/source/hls/adapters/profiles/standard";
import {
    HLSKeyReferenceKind,
    HLSMediaPlaylist,
    HLSPlaylistKind,
    HLSSegmentKind,
} from "../../../../../../src/core/source/hls/parser";
import { createProtectedInitialization } from "../../../../../helpers/isobmff";

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

        await plan.ensureKeys(playlist, context, new AbortController().signal);

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
    test("maps one key to every protected track id in a cbcs initialization", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        jest.spyOn(http, "request").mockResolvedValue({ data: createProtectedInitialization(7) } as never);
        const context = { http, keys: new KeyStore() };
        const playlist = createFmp4SampleAesPlaylist();
        const explicitKey = "22".repeat(16);
        const plan = await fmp4HLSProfile.prepare({ playlist, explicitKeys: [{ key: explicitKey }], http });

        await plan.ensureKeys(playlist, context, new AbortController().signal);

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
        jest.spyOn(http, "request").mockResolvedValue({ data: createProtectedInitialization() } as never);
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

        await plan.ensureKeys(playlist, context, new AbortController().signal);

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

    test("rejects missing explicit keys and non-cbcs protection before publishing items", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const playlist = createFmp4SampleAesPlaylist();
        const context = { http, keys: new KeyStore() };
        const noKeyPlan = await fmp4HLSProfile.prepare({ playlist, explicitKeys: [], http });

        await expect(noKeyPlan.ensureKeys(playlist, context, new AbortController().signal)).rejects.toThrow(
            "explicit decryption key"
        );

        jest.spyOn(http, "request").mockResolvedValue({ data: createProtectedInitialization(1, "cenc") } as never);
        const wrongSchemePlan = await fmp4HLSProfile.prepare({
            playlist,
            explicitKeys: [{ key: "11".repeat(16) }],
            http,
        });
        await expect(wrongSchemePlan.ensureKeys(playlist, context, new AbortController().signal)).rejects.toThrow(
            "protected cbcs"
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
