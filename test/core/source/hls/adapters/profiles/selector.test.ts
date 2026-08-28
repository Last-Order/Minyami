import { describe, expect, jest, test } from "@jest/globals";
import { runWithAbortSignal } from "@/utils/abort";
import { fmp4HLSProfile } from "@/core/source/hls/adapters/profiles/fmp4";
import { packedAacHLSProfile } from "@/core/source/hls/adapters/profiles/packed_aac";
import { mpegTsHLSProfile } from "@/core/source/hls/adapters/profiles/mpeg_ts";
import { selectHLSProfile as selectHLSProfileWithContext } from "@/core/source/hls/adapters/profiles/selector";
import {
    HLSKeyReferenceKind,
    HLSMediaPlaylist,
    HLSPlaylistKind,
    HLSSegmentKind,
} from "@/core/source/hls/playlist/parser";
import { DownloadSourceHttpClient } from "@/core/source/types";
import { createClearInitialization } from "../../../../../helpers/isobmff";

describe("HLS profile selection", () => {
    test("selects fMP4 from consistent initialization and media locators without probing", async () => {
        const http = unusedHttp();
        const playlist = createMappedPlaylist("https://media.example/init.mp4", "https://media.example/0.m4s");

        await expect(selectHLSProfile(playlist, http, signal())).resolves.toBe(fmp4HLSProfile);
        expect(http.request).not.toHaveBeenCalled();
    });

    test("recognizes an opaque fMP4 initialization from its required ftyp and moov boxes", async () => {
        const request = jest.fn<DownloadSourceHttpClient["request"]>(async () => ({
            data: createClearInitialization(),
            status: 206,
        })) as DownloadSourceHttpClient["request"];

        await expect(
            selectHLSProfile(
                createMappedPlaylist("https://media.example/init", "https://media.example/0"),
                createHttp(request),
                signal()
            )
        ).resolves.toBe(fmp4HLSProfile);
        expect(request).toHaveBeenCalledTimes(1);
    });

    test("recognizes an opaque MPEG-TS EXT-X-MAP containing PAT followed by PMT", async () => {
        const initialization = createMpegTsInitialization();
        const resource = Buffer.concat([Buffer.from("prefix"), initialization, Buffer.from("suffix")]);
        const request = jest.fn<DownloadSourceHttpClient["request"]>(async (_url, options) => {
            expect(options?.headers).toMatchObject({
                Range: `bytes=6-${6 + initialization.length - 1}`,
                "Accept-Encoding": "identity",
            });
            return { data: resource, status: 200 } as never;
        });
        const playlist = createMappedPlaylist("https://media.example/init", "https://media.example/0", {
            byteRange: { offset: 6, length: initialization.length },
        });

        await expect(selectHLSProfile(playlist, createHttp(request), signal())).resolves.toBe(mpegTsHLSProfile);
        expect(request).toHaveBeenCalledTimes(1);
    });

    test("rejects an opaque MPEG-TS EXT-X-MAP without PAT and PMT", async () => {
        const invalidInitialization = Buffer.alloc(188 * 2);
        invalidInitialization[0] = 0x47;
        invalidInitialization[188] = 0x47;
        const request = jest.fn<DownloadSourceHttpClient["request"]>(async () => ({
            data: invalidInitialization,
            status: 206,
        })) as DownloadSourceHttpClient["request"];

        await expect(
            selectHLSProfile(
                createMappedPlaylist("https://media.example/init", "https://media.example/0"),
                createHttp(request),
                signal()
            )
        ).rejects.toThrow("must contain a PAT followed by a PMT");
    });

    test("rejects an opaque fMP4 EXT-X-MAP without the required moov box", async () => {
        const request = jest.fn<DownloadSourceHttpClient["request"]>(async () => ({
            data: createIsoBmffBox("ftyp", Buffer.from("iso600000001iso6")),
            status: 206,
        })) as DownloadSourceHttpClient["request"];

        await expect(
            selectHLSProfile(
                createMappedPlaylist("https://media.example/init", "https://media.example/0"),
                createHttp(request),
                signal()
            )
        ).rejects.toThrow("ftyp box followed by a moov box");
    });

    test("rejects Packed AAC locators combined with EXT-X-MAP", async () => {
        await expect(
            selectHLSProfile(
                createMappedPlaylist("https://media.example/init", "https://media.example/0.aac"),
                unusedHttp(),
                signal()
            )
        ).rejects.toThrow("Packed Audio HLS must not contain an EXT-X-MAP");
    });

    test("rejects fMP4 locators without EXT-X-MAP", async () => {
        await expect(
            selectHLSProfile(createClearPlaylist("https://media.example/0.m4s"), unusedHttp(), signal())
        ).rejects.toThrow("fMP4 HLS media requires an EXT-X-MAP");
    });

    test.each([
        ["https://media.example/segment.ts", mpegTsHLSProfile],
        ["https://media.example/segment.m2ts?token=1", mpegTsHLSProfile],
        ["https://media.example/audio.aac", packedAacHLSProfile],
    ] as const)("selects the profile from the media extension in %s", async (url, expected) => {
        const http = unusedHttp();

        await expect(selectHLSProfile(createClearPlaylist(url), http, signal())).resolves.toBe(expected);
        expect(http.request).not.toHaveBeenCalled();
    });

    test("preserves the MPEG-TS profile default for an empty playlist", async () => {
        const http = unusedHttp();

        await expect(selectHLSProfile(createPlaylist([]), http, signal())).resolves.toBe(mpegTsHLSProfile);
        expect(http.request).not.toHaveBeenCalled();
    });

    test("preserves the MPEG-TS profile default for opaque clear media", async () => {
        const http = unusedHttp();

        await expect(
            selectHLSProfile(createClearPlaylist("https://media.example/opaque"), http, signal())
        ).resolves.toBe(mpegTsHLSProfile);
        expect(http.request).not.toHaveBeenCalled();
    });

    test("recognizes ID3 plus ADTS behind an opaque SAMPLE-AES locator", async () => {
        const prefix = Buffer.concat([createId3Tag(Buffer.from("timestamp")), createAdtsHeader(64)]);
        const request = jest.fn<DownloadSourceHttpClient["request"]>(async (_url, options) => {
            expect(options?.headers).toMatchObject({ Range: "bytes=0-16383", "Accept-Encoding": "identity" });
            return { data: prefix, status: 206 } as never;
        });
        const http = createHttp(request);

        await expect(
            selectHLSProfile(createSampleAesPlaylist("https://media.example/opaque"), http, signal())
        ).resolves.toBe(packedAacHLSProfile);
        expect(request).toHaveBeenCalledTimes(1);
    });

    test("recognizes MPEG-TS bytes behind an opaque SAMPLE-AES locator", async () => {
        const prefix = Buffer.alloc(188 * 3);
        prefix[0] = 0x47;
        prefix[188] = 0x47;
        prefix[376] = 0x47;
        const request = jest.fn<DownloadSourceHttpClient["request"]>(async () => ({
            data: prefix,
            status: 206,
        })) as DownloadSourceHttpClient["request"];

        await expect(
            selectHLSProfile(createSampleAesPlaylist("https://media.example/opaque"), createHttp(request), signal())
        ).resolves.toBe(mpegTsHLSProfile);
    });

    test("rejects an opaque SAMPLE-AES payload without a supported profile", async () => {
        const request = jest.fn<DownloadSourceHttpClient["request"]>(async () => ({
            data: Buffer.from("not media"),
            status: 206,
        })) as DownloadSourceHttpClient["request"];

        await expect(
            selectHLSProfile(createSampleAesPlaylist("https://media.example/opaque"), createHttp(request), signal())
        ).rejects.toThrow("Unable to determine");
    });
});

function createClearPlaylist(url: string): HLSMediaPlaylist {
    return createPlaylist([
        {
            kind: HLSSegmentKind.Media,
            url,
            duration: 1,
            sequenceId: 0,
        },
    ]);
}

function createMappedPlaylist(
    initializationUrl: string,
    mediaUrl: string,
    initializationOptions: { readonly byteRange?: { readonly offset: number; readonly length: number } } = {}
): HLSMediaPlaylist {
    const initializationId = "init";
    return createPlaylist([
        {
            kind: HLSSegmentKind.Initialization,
            initializationId,
            url: initializationUrl,
            ...(initializationOptions.byteRange ? { byteRange: initializationOptions.byteRange } : {}),
        },
        {
            kind: HLSSegmentKind.Media,
            initializationId,
            url: mediaUrl,
            duration: 1,
            sequenceId: 0,
        },
    ]);
}

function createSampleAesPlaylist(url: string): HLSMediaPlaylist {
    const key = {
        kind: HLSKeyReferenceKind.External,
        id: "skd://asset",
        uri: "skd://asset",
    } as const;
    return createPlaylist(
        [
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
        [key]
    );
}

function createPlaylist(segments: HLSMediaPlaylist["segments"], keys: HLSMediaPlaylist["keys"] = []): HLSMediaPlaylist {
    return {
        kind: HLSPlaylistKind.Media,
        segments,
        keys,
        hasEndList: true,
        totalDuration: 1,
        averageSegmentDuration: 1,
    };
}

function unusedHttp(): DownloadSourceHttpClient {
    return createHttp(jest.fn<DownloadSourceHttpClient["request"]>());
}

function createHttp(request: DownloadSourceHttpClient["request"]): DownloadSourceHttpClient {
    return {
        get: jest.fn<DownloadSourceHttpClient["get"]>(),
        request,
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

function createMpegTsInitialization(): Buffer {
    const programMapPid = 0x100;
    const pat = Buffer.alloc(16);
    pat[0] = 0x00;
    pat[1] = 0xb0;
    pat[2] = 13;
    pat.writeUInt16BE(1, 3);
    pat[5] = 0xc1;
    pat.writeUInt16BE(1, 8);
    pat[10] = 0xe0 | (programMapPid >> 8);
    pat[11] = programMapPid & 0xff;

    const pmt = Buffer.alloc(16);
    pmt[0] = 0x02;
    pmt[1] = 0xb0;
    pmt[2] = 13;
    pmt.writeUInt16BE(1, 3);
    pmt[5] = 0xc1;
    pmt[8] = 0xe1;

    return Buffer.concat([createPsiPacket(0, pat), createPsiPacket(programMapPid, pmt)]);
}

function createIsoBmffBox(type: string, payload: Buffer): Buffer {
    const box = Buffer.alloc(8 + payload.length);
    box.writeUInt32BE(box.length);
    box.write(type, 4, 4, "latin1");
    payload.copy(box, 8);
    return box;
}

function createPsiPacket(pid: number, section: Buffer): Buffer {
    const packet = Buffer.alloc(188, 0xff);
    packet[0] = 0x47;
    packet[1] = 0x40 | ((pid >> 8) & 0x1f);
    packet[2] = pid & 0xff;
    packet[3] = 0x10;
    packet[4] = 0;
    section.copy(packet, 5);
    return packet;
}

function selectHLSProfile(playlist: HLSMediaPlaylist, http: DownloadSourceHttpClient, abortSignal: AbortSignal) {
    return runWithAbortSignal(abortSignal, () => selectHLSProfileWithContext(playlist, http));
}

function signal(): AbortSignal {
    return new AbortController().signal;
}
