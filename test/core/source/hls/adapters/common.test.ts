import { describe, expect, jest, test } from "@jest/globals";
import { normalizeDownloaderConfig } from "../../../../../src/core/download/config";
import { DownloadHttpClient } from "../../../../../src/core/download/infrastructure/http_client";
import { adaptCommon } from "../../../../../src/core/source/hls/adapters/common";
import {
    HLSKeyReference,
    HLSKeyReferenceKind,
    HLSMediaPlaylist,
    HLSPlaylistKind,
} from "../../../../../src/core/source/hls/parser";

describe("common HLS adapter key resolution", () => {
    test("resolves an inline data key without an explicit key", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const request = jest.spyOn(http, "request");
        const key: HLSKeyReference = {
            kind: HLSKeyReferenceKind.Inline,
            id: "data:application/octet-stream;base64,AAECAwQFBgcICQoLDA0ODw==",
            uri: "data:application/octet-stream;base64,AAECAwQFBgcICQoLDA0ODw==",
        };
        const signal = new AbortController().signal;
        const adapter = await adaptCommon({
            mode: "archive",
            sourcePath: "https://media.example/playlist.m3u8",
            playlist: createPlaylist(key),
            explicitKeys: [],
            http,
        });

        await expect(adapter.keyResolver!({ keys: [key], signal })).resolves.toEqual({
            [key.id]: "000102030405060708090a0b0c0d0e0f",
        });
        expect(request).toHaveBeenCalledWith(key.uri, { responseType: "arraybuffer", signal });
    });

    test("requires an explicit key without requesting an external key URI", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const request = jest.spyOn(http, "request");
        const key: HLSKeyReference = {
            kind: HLSKeyReferenceKind.External,
            id: "skd://example?assetId=test",
            uri: "skd://example?assetId=test",
        };
        const adapter = await adaptCommon({
            mode: "archive",
            sourcePath: "https://media.example/playlist.m3u8",
            playlist: createPlaylist(key),
            explicitKeys: [],
            http,
        });

        await expect(adapter.keyResolver!({ keys: [key], signal: new AbortController().signal })).rejects.toThrow(
            "An explicit decryption key is required for this HLS key reference."
        );
        expect(request).not.toHaveBeenCalled();
    });

    test("rejects a mixed key batch before requesting its HTTP key", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const request = jest.spyOn(http, "request");
        const httpKey: HLSKeyReference = {
            kind: HLSKeyReferenceKind.Http,
            id: "https://media.example/key.bin",
            url: "https://media.example/key.bin",
        };
        const externalKey: HLSKeyReference = {
            kind: HLSKeyReferenceKind.External,
            id: "skd://example?assetId=test",
            uri: "skd://example?assetId=test",
        };
        const adapter = await adaptCommon({
            mode: "archive",
            sourcePath: "https://media.example/playlist.m3u8",
            playlist: createPlaylist(httpKey),
            explicitKeys: [],
            http,
        });

        await expect(
            adapter.keyResolver!({ keys: [httpKey, externalKey], signal: new AbortController().signal })
        ).rejects.toThrow("An explicit decryption key is required for this HLS key reference.");
        expect(request).not.toHaveBeenCalled();
    });

    test("registers an explicit key for an external identity without requesting its URI", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const request = jest.spyOn(http, "request");
        const key: HLSKeyReference = {
            kind: HLSKeyReferenceKind.External,
            id: "skd://example?assetId=test",
            uri: "skd://example?assetId=test",
        };
        const explicitKey = "00".repeat(16);
        const adapter = await adaptCommon({
            mode: "archive",
            sourcePath: "https://media.example/playlist.m3u8",
            playlist: createPlaylist(key),
            explicitKeys: [{ kid: "asset-id", key: explicitKey }],
            http,
        });

        await expect(adapter.keyResolver!({ keys: [key], signal: new AbortController().signal })).resolves.toEqual({
            [key.id]: explicitKey,
        });
        expect(request).not.toHaveBeenCalled();
    });
});

function createPlaylist(key: HLSKeyReference): HLSMediaPlaylist {
    return {
        kind: HLSPlaylistKind.Media,
        segments: [],
        keys: [key],
        hasEndList: true,
        totalDuration: 0,
        averageSegmentDuration: 0,
    };
}
