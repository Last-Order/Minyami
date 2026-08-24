import { describe, expect, test } from "@jest/globals";
import { parseMediaPlaylist } from "../../../../../src/core/source/hls/playlist/media";
import {
    HLSKeyReferenceKind,
    HLSParseError,
    HLSPlaylistKind,
    HLSSegmentKind,
} from "../../../../../src/core/source/hls/playlist/parser";

describe("parseMediaPlaylist", () => {
    test("parses sequence, initialization, segment, end, and duration metadata", () => {
        const initializationId = '["https://cdn.example/live/init.mp4",null,null]';
        const playlist = parseMediaPlaylist({
            content: [
                "#EXTM3U",
                "#EXT-X-MEDIA-SEQUENCE:41",
                '#EXT-X-MAP:URI="init.mp4"',
                "#EXTINF:4.25,first segment",
                "#EXT-X-BYTERANGE:1000@0",
                "",
                "# segment comment",
                "segments/41.m4s",
                "#EXTINF:5.75,second segment",
                "https://cdn.example/42.m4s",
                "#EXT-X-ENDLIST",
                "#EXTINF:10,ignored after end list",
                "segments/43.m4s",
            ].join("\n"),
            playlistUrl: "https://cdn.example/live/playlist.m3u8",
        });

        expect(playlist).toEqual({
            kind: HLSPlaylistKind.Media,
            segments: [
                {
                    kind: HLSSegmentKind.Initialization,
                    initializationId,
                    url: "https://cdn.example/live/init.mp4",
                },
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://cdn.example/live/segments/41.m4s",
                    duration: 4.25,
                    sequenceId: 41,
                    initializationId,
                    byteRange: { offset: 0, length: 1000 },
                },
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://cdn.example/42.m4s",
                    duration: 5.75,
                    sequenceId: 42,
                    initializationId,
                },
            ],
            keys: [],
            hasEndList: true,
            totalDuration: 10,
            averageSegmentDuration: 5,
        });
    });

    test("resolves initialization and explicit or implicit media byte ranges", () => {
        const initializationId = '["https://cdn.example/media.mp4",0,20]';
        const playlist = parseMediaPlaylist({
            content: [
                "#EXTM3U",
                '#EXT-X-MAP:URI="media.mp4",BYTERANGE="20@0"',
                "#EXTINF:1,",
                "#EXT-X-BYTERANGE:4@20",
                "media.mp4",
                "#EXT-X-BYTERANGE:5",
                "#EXTINF:1,",
                "media.mp4",
            ].join("\n"),
            playlistUrl: "https://cdn.example/playlist.m3u8",
        });

        expect(playlist.segments).toEqual([
            {
                kind: HLSSegmentKind.Initialization,
                initializationId,
                url: "https://cdn.example/media.mp4",
                byteRange: { offset: 0, length: 20 },
            },
            {
                kind: HLSSegmentKind.Media,
                url: "https://cdn.example/media.mp4",
                duration: 1,
                sequenceId: 0,
                initializationId,
                byteRange: { offset: 20, length: 4 },
            },
            {
                kind: HLSSegmentKind.Media,
                url: "https://cdn.example/media.mp4",
                duration: 1,
                sequenceId: 1,
                initializationId,
                byteRange: { offset: 24, length: 5 },
            },
        ]);
    });

    test.each([
        ["a malformed range", "invalid", "Invalid byte range for media segment"],
        ["a zero-length range", "0@0", "Invalid byte range for media segment"],
        ["an overflowing range", "2@9007199254740991", "Invalid byte range for media segment"],
    ])("rejects %s", (_name, byteRange, message) => {
        const content = ["#EXTINF:1,", `#EXT-X-BYTERANGE:${byteRange}`, "https://cdn.example/media.mp4"].join("\n");

        expect(() => parseMediaPlaylist({ content })).toThrow(new HLSParseError(message));
    });

    test("rejects an implicit media byte range without an adjacent range of the same resource", () => {
        const invalidPlaylists = [
            ["#EXTINF:1,", "#EXT-X-BYTERANGE:4", "https://cdn.example/media.mp4"],
            [
                "#EXTINF:1,",
                "#EXT-X-BYTERANGE:4@0",
                "https://cdn.example/first.mp4",
                "#EXTINF:1,",
                "#EXT-X-BYTERANGE:4",
                "https://cdn.example/second.mp4",
            ],
            [
                "#EXTINF:1,",
                "https://cdn.example/media.mp4",
                "#EXTINF:1,",
                "#EXT-X-BYTERANGE:4",
                "https://cdn.example/media.mp4",
            ],
        ];

        for (const lines of invalidPlaylists) {
            expect(() => parseMediaPlaylist({ content: lines.join("\n") })).toThrow(
                new HLSParseError("Cannot derive byte-range offset for media segment")
            );
        }
    });

    test("rejects an initialization byte range without an explicit offset", () => {
        expect(() =>
            parseMediaPlaylist({
                content: '#EXT-X-MAP:URI="https://cdn.example/init.mp4",BYTERANGE="100"',
            })
        ).toThrow(new HLSParseError("Missing byte-range offset for initialization segment"));
    });

    test("rejects encrypted I-frame byte ranges that require CBC range widening", () => {
        expect(() =>
            parseMediaPlaylist({
                content: [
                    "#EXT-X-I-FRAMES-ONLY",
                    '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/key",IV=0x01',
                    "#EXTINF:1,",
                    "#EXT-X-BYTERANGE:32@16",
                    "https://cdn.example/media.ts",
                ].join("\n"),
            })
        ).toThrow(new HLSParseError("Encrypted I-frame byte ranges are not supported"));
    });

    test("treats I-FRAMES-ONLY as global when declared after a ranged segment", () => {
        expect(() =>
            parseMediaPlaylist({
                content: [
                    "#EXTM3U",
                    '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/key",IV=0x01',
                    "#EXTINF:1,",
                    "#EXT-X-BYTERANGE:32@16",
                    "https://cdn.example/media.ts",
                    "#EXT-X-I-FRAMES-ONLY",
                    "#EXT-X-ENDLIST",
                ].join("\n"),
            })
        ).toThrow(new HLSParseError("Encrypted I-frame byte ranges are not supported"));
    });

    test("applies AES-128 metadata until encryption is disabled", () => {
        const iv = "0000000000000000000000000000000a";
        const keyUrl = "https://cdn.example/live/keys/key.bin";
        const playlist = parseMediaPlaylist({
            content: [
                "#EXTM3U",
                "#EXT-X-MEDIA-SEQUENCE:10",
                `#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin",IV=0x${iv}`,
                '#EXT-X-MAP:URI="init.mp4"',
                "#EXTINF:1.5,",
                "10.m4s",
                "#EXT-X-KEY:METHOD=NONE",
                "#EXTINF:2,",
                "11.m4s",
            ].join("\n"),
            playlistUrl: "https://cdn.example/live/playlist.m3u8",
        });

        const key = { kind: HLSKeyReferenceKind.Http, id: keyUrl, url: keyUrl } as const;
        const initializationId = '["https://cdn.example/live/init.mp4",null,null]';
        expect(playlist.keys).toEqual([key]);
        expect(playlist.segments).toEqual([
            {
                kind: HLSSegmentKind.Initialization,
                initializationId,
                url: "https://cdn.example/live/init.mp4",
                encryption: { method: "AES-128", key, iv },
            },
            {
                kind: HLSSegmentKind.Media,
                url: "https://cdn.example/live/10.m4s",
                duration: 1.5,
                sequenceId: 10,
                initializationId,
                encryption: { method: "AES-128", key, iv },
            },
            {
                kind: HLSSegmentKind.Media,
                url: "https://cdn.example/live/11.m4s",
                duration: 2,
                sequenceId: 11,
                initializationId,
            },
        ]);
    });

    test("applies encryption tags that appear between EXTINF and its media URI", () => {
        const playlist = parseMediaPlaylist({
            content: [
                "#EXTINF:1,",
                '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/key",IV=0x01',
                "https://cdn.example/media.ts",
            ].join("\n"),
        });

        expect(playlist.segments[0]).toMatchObject({
            encryption: {
                method: "AES-128",
                key: {
                    kind: HLSKeyReferenceKind.Http,
                    id: "https://cdn.example/key",
                    url: "https://cdn.example/key",
                },
                iv: "01",
            },
        });
    });

    test("keeps delimiters inside quoted encryption attributes", () => {
        const keyUri = "keys/key.bin?token=a=b,c";
        const keyUrl = `https://cdn.example/live/${keyUri}`;
        const playlist = parseMediaPlaylist({
            content: [`#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}"`, "#EXTINF:1,", "0.ts"].join("\n"),
            playlistUrl: "https://cdn.example/live/playlist.m3u8",
        });

        const key = { kind: HLSKeyReferenceKind.Http, id: keyUrl, url: keyUrl } as const;
        expect(playlist.keys).toEqual([key]);
        expect(playlist.segments[0]).toMatchObject({ encryption: { key } });
    });

    test("leaves an omitted media IV for the source to derive from its sequence", () => {
        const playlist = parseMediaPlaylist({
            content: [
                "#EXTM3U",
                "#EXT-X-MEDIA-SEQUENCE:7",
                '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/key.bin"',
                "#EXTINF:1,",
                "https://cdn.example/7.ts",
            ].join("\n"),
        });

        expect(playlist.segments[0]).toMatchObject({
            kind: HLSSegmentKind.Media,
            sequenceId: 7,
            encryption: {
                key: {
                    kind: HLSKeyReferenceKind.Http,
                    id: "https://cdn.example/key.bin",
                    url: "https://cdn.example/key.bin",
                },
            },
        });
        expect(playlist.segments[0].encryption).not.toHaveProperty("iv");
    });

    test("does not carry an explicit IV into a later key declaration", () => {
        const playlist = parseMediaPlaylist({
            content: [
                '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/first.key",IV=0X01',
                "#EXTINF:1,",
                "https://cdn.example/0.ts",
                '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/second.key"',
                "#EXTINF:1,",
                "https://cdn.example/1.ts",
            ].join("\n"),
        });

        expect(playlist.segments[0]).toMatchObject({ encryption: { iv: "01" } });
        expect(playlist.segments[1]).toMatchObject({
            encryption: {
                key: {
                    kind: HLSKeyReferenceKind.Http,
                    id: "https://cdn.example/second.key",
                    url: "https://cdn.example/second.key",
                },
            },
        });
        expect(playlist.segments[1].encryption).not.toHaveProperty("iv");
    });

    test("keeps a non-HTTP absolute key URI as an external identity", () => {
        const keyUri = "skd://streaks?assetId=test";
        const playlist = parseMediaPlaylist({
            content: [
                `#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}",IV=0x01`,
                "#EXTINF:1,",
                "https://cdn.example/0.ts",
            ].join("\n"),
        });
        const key = { kind: HLSKeyReferenceKind.External, id: keyUri, uri: keyUri } as const;

        expect(playlist.keys).toEqual([key]);
        expect(playlist.segments[0]).toMatchObject({ encryption: { key } });
    });

    test("keeps a data key URI as an inline identity", () => {
        const keyUri = "data:application/octet-stream;base64,AAECAwQFBgcICQoLDA0ODw==";
        const playlist = parseMediaPlaylist({
            content: [
                `#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}",IV=0x01`,
                "#EXTINF:1,",
                "https://cdn.example/0.ts",
            ].join("\n"),
        });
        const key = { kind: HLSKeyReferenceKind.Inline, id: keyUri, uri: keyUri } as const;

        expect(playlist.keys).toEqual([key]);
        expect(playlist.segments[0]).toMatchObject({ encryption: { key } });
    });

    test.each(["prefix0x01", "0xGG", `0x${"0".repeat(33)}`])("rejects malformed IV %s", (iv) => {
        const content = [
            `#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/key.bin",IV=${iv}`,
            "#EXTINF:1,",
            "https://cdn.example/0.ts",
        ].join("\n");

        expect(() => parseMediaPlaylist({ content })).toThrow(new HLSParseError("Invalid IV for encryption key"));
    });

    test("parses SAMPLE-AES FairPlay metadata with an explicit IV", () => {
        const keyUri = "skd://asset-id";
        const playlist = parseMediaPlaylist({
            content: [
                "#EXTM3U",
                `#EXT-X-KEY:METHOD=SAMPLE-AES,URI="${keyUri}",KEYFORMAT="com.apple.streamingkeydelivery",IV=0x01`,
                "#EXTINF:1,",
                "https://cdn.example/0.ts",
            ].join("\n"),
        });

        const key = { kind: HLSKeyReferenceKind.External, id: keyUri, uri: keyUri } as const;
        expect(playlist.keys).toEqual([key]);
        expect(playlist.segments[0]).toMatchObject({
            encryption: {
                method: "SAMPLE-AES",
                key,
                iv: "01",
                keyFormat: "com.apple.streamingkeydelivery",
            },
        });
    });

    test("allows SAMPLE-AES without a playlist IV", () => {
        const playlist = parseMediaPlaylist({
            content: [
                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://asset",KEYFORMAT="com.apple.streamingkeydelivery"',
                "#EXTINF:1,",
                "https://cdn.example/0.ts",
            ].join("\n"),
        });

        expect(playlist.segments[0]).toMatchObject({
            encryption: { method: "SAMPLE-AES", keyFormat: "com.apple.streamingkeydelivery" },
        });
    });

    test("preserves opaque SAMPLE-AES key formats without implementing their DRM protocol", () => {
        const playlist = parseMediaPlaylist({
            content: [
                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,dGVzdA==",KEYFORMAT="vendor.example"',
                "#EXTINF:1,",
                "https://cdn.example/0.m4s",
            ].join("\n"),
        });

        expect(playlist.segments[0]).toMatchObject({
            encryption: { method: "SAMPLE-AES", keyFormat: "vendor.example" },
        });
    });

    test("accepts parallel FairPlay, PlayReady, and Widevine SAMPLE-AES declarations", () => {
        const playlist = parseMediaPlaylist({
            content: [
                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://asset",KEYFORMAT="com.apple.streamingkeydelivery"',
                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,cGxheXJlYWR5",KEYFORMAT="com.microsoft.playready"',
                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,d2lkZXZpbmU=",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"',
                '#EXT-X-MAP:URI="https://cdn.example/init.mp4"',
                "#EXTINF:1,",
                "https://cdn.example/0.m4s",
            ].join("\n"),
        });

        expect(playlist.keys).toHaveLength(3);
        expect(playlist.segments).toHaveLength(2);
        expect(playlist.segments[1]).toMatchObject({
            encryption: {
                method: "SAMPLE-AES",
                keyFormat: "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",
            },
        });
    });

    test("associates SAMPLE-AES fMP4 media with its initialization segment", () => {
        const playlist = parseMediaPlaylist({
            content: [
                '#EXT-X-MAP:URI="https://cdn.example/init.mp4"',
                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://asset",KEYFORMAT="com.apple.streamingkeydelivery"',
                "#EXTINF:1,",
                "https://cdn.example/0.m4s",
            ].join("\n"),
        });

        expect(playlist.segments).toHaveLength(2);
        expect(playlist.segments[1]).toMatchObject({
            initializationId: playlist.segments[0].initializationId,
            encryption: { method: "SAMPLE-AES" },
        });
    });

    test("rejects SAMPLE-AES-CTR explicitly", () => {
        expect(() =>
            parseMediaPlaylist({
                content: [
                    '#EXT-X-KEY:METHOD=SAMPLE-AES-CTR,URI="skd://asset"',
                    "#EXTINF:1,",
                    "https://cdn.example/0.m4s",
                ].join("\n"),
            })
        ).toThrow(new HLSParseError("SAMPLE-AES-CTR encryption is not supported"));
    });

    test.each([
        {
            name: "an initialization segment without a URI",
            content: '#EXT-X-MAP:BYTERANGE="100@0"',
            expectedMessage: "Missing URL for initialization segment",
        },
        {
            name: "a relative initialization segment without a playlist URL",
            content: '#EXT-X-MAP:URI="init.mp4"',
            expectedMessage: "Missing base URL for HLS playlist.",
        },
        {
            name: "an encrypted initialization segment without an IV",
            content: [
                '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/key.bin"',
                '#EXT-X-MAP:URI="https://cdn.example/init.mp4"',
            ].join("\n"),
            expectedMessage: "Missing IV for encrypted initialization segment",
        },
        {
            name: "an encryption key without a URI",
            content: ["#EXT-X-KEY:METHOD=AES-128", "#EXTINF:1,", "https://cdn.example/0.ts"].join("\n"),
            expectedMessage: "Missing URL for encryption key",
        },
        {
            name: "an invalid encryption IV",
            content: [
                '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/key.bin",IV=invalid',
                "#EXTINF:1,",
                "https://cdn.example/0.ts",
            ].join("\n"),
            expectedMessage: "Invalid IV for encryption key",
        },
        {
            name: "a media tag without a segment URI",
            content: "#EXTINF:1,\n",
            expectedMessage: "Invalid HLS playlist.",
        },
        {
            name: "a relative media URI without a playlist URL",
            content: ["#EXTINF:1,", "0.ts"].join("\n"),
            expectedMessage: "Missing base URL for HLS playlist.",
        },
        {
            name: "a relative encryption key URI without a playlist URL",
            content: ["#EXT-X-KEY:METHOD=AES-128,URI=key.bin", "#EXTINF:1,", "https://cdn.example/0.ts"].join("\n"),
            expectedMessage: "Missing base URL for HLS playlist.",
        },
    ])("rejects $name", ({ content, expectedMessage }) => {
        expect(() => parseMediaPlaylist({ content })).toThrow(new HLSParseError(expectedMessage));
    });
});
