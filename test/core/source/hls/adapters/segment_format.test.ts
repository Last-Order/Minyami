import { describe, expect, jest, test } from "@jest/globals";
import { detectHLSMediaSegmentFormat } from "../../../../../src/core/source/hls/adapters/segment_format";
import {
    HLSKeyReferenceKind,
    HLSMediaPlaylist,
    HLSPlaylistKind,
    HLSSegmentKind,
} from "../../../../../src/core/source/hls/parser";
import { DownloadSourceHttpClient } from "../../../../../src/core/source/types";

describe("HLS media-segment format detection", () => {
    test("recognizes ID3 plus ADTS behind an opaque SAMPLE-AES locator", async () => {
        const prefix = Buffer.concat([createId3Tag(Buffer.from("timestamp")), createAdtsHeader(64)]);
        const request = jest.fn<DownloadSourceHttpClient["request"]>(async (_url, options) => {
            expect(options?.headers).toMatchObject({ Range: "bytes=0-16383", "Accept-Encoding": "identity" });
            return { data: prefix, status: 206 } as never;
        });
        const http: DownloadSourceHttpClient = {
            get: jest.fn<DownloadSourceHttpClient["get"]>(),
            request,
        };

        await expect(
            detectHLSMediaSegmentFormat(createSampleAesPlaylist("https://media.example/opaque"), http, signal())
        ).resolves.toBe("packed-aac");
        expect(request).toHaveBeenCalledTimes(1);
    });

    test("rejects an opaque SAMPLE-AES payload without a supported envelope", async () => {
        const http: DownloadSourceHttpClient = {
            get: jest.fn<DownloadSourceHttpClient["get"]>(),
            request: jest.fn<DownloadSourceHttpClient["request"]>(async () => ({
                data: Buffer.from("not media"),
                status: 206,
            })) as DownloadSourceHttpClient["request"],
        };

        await expect(
            detectHLSMediaSegmentFormat(createSampleAesPlaylist("https://media.example/opaque"), http, signal())
        ).rejects.toThrow("Unable to determine");
    });
});

function createSampleAesPlaylist(url: string): HLSMediaPlaylist {
    const key = {
        kind: HLSKeyReferenceKind.External,
        id: "skd://asset",
        uri: "skd://asset",
    } as const;
    return {
        kind: HLSPlaylistKind.Media,
        segments: [
            {
                kind: HLSSegmentKind.Media,
                url,
                duration: 1,
                sequenceId: 0,
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
        totalDuration: 1,
        averageSegmentDuration: 1,
    };
}

function createId3Tag(body: Buffer): Buffer {
    return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, body.length]), body]);
}

function createAdtsHeader(frameLength: number): Buffer {
    return Buffer.from([
        0xff,
        0xf1,
        0x4c,
        0x80 | ((frameLength >> 11) & 3),
        (frameLength >> 3) & 0xff,
        ((frameLength & 7) << 5) | 0x1f,
        0xfc,
    ]);
}

function signal(): AbortSignal {
    return new AbortController().signal;
}
