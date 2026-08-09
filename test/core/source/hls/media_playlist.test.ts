import { describe, expect, jest, test } from "@jest/globals";
import { parseMediaPlaylist } from "../../../../src/core/source/hls/media_playlist";
import { HLSParseError, HLSPlaylistKind, HLSSegmentKind } from "../../../../src/core/source/hls/parser";
import logger from "../../../../src/utils/log";

describe("parseMediaPlaylist", () => {
    test("parses sequence, initialization, segment, end, and duration metadata", () => {
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
                { kind: HLSSegmentKind.Initialization, url: "https://cdn.example/live/init.mp4" },
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://cdn.example/live/segments/41.m4s",
                    duration: 4.25,
                    sequenceId: 41,
                },
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://cdn.example/42.m4s",
                    duration: 5.75,
                    sequenceId: 42,
                },
            ],
            encryptionKeyUrls: [],
            hasEndList: true,
            totalDuration: 10,
            averageSegmentDuration: 5,
        });
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

        expect(playlist.encryptionKeyUrls).toEqual([keyUrl]);
        expect(playlist.segments).toEqual([
            {
                kind: HLSSegmentKind.Initialization,
                url: "https://cdn.example/live/init.mp4",
                encryption: { method: "AES-128", keyUrl, iv },
            },
            {
                kind: HLSSegmentKind.Media,
                url: "https://cdn.example/live/10.m4s",
                duration: 1.5,
                sequenceId: 10,
                encryption: { method: "AES-128", keyUrl, iv },
            },
            {
                kind: HLSSegmentKind.Media,
                url: "https://cdn.example/live/11.m4s",
                duration: 2,
                sequenceId: 11,
            },
        ]);
    });

    test("keeps delimiters inside quoted encryption attributes", () => {
        const keyUri = "keys/key.bin?token=a=b,c";
        const keyUrl = `https://cdn.example/live/${keyUri}`;
        const playlist = parseMediaPlaylist({
            content: [`#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}"`, "#EXTINF:1,", "0.ts"].join("\n"),
            playlistUrl: "https://cdn.example/live/playlist.m3u8",
        });

        expect(playlist.encryptionKeyUrls).toEqual([keyUrl]);
        expect(playlist.segments[0]).toMatchObject({ encryption: { keyUrl } });
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
            encryption: { keyUrl: "https://cdn.example/key.bin" },
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
        expect(playlist.segments[1]).toMatchObject({ encryption: { keyUrl: "https://cdn.example/second.key" } });
        expect(playlist.segments[1].encryption).not.toHaveProperty("iv");
    });

    test.each(["prefix0x01", "0xGG", `0x${"0".repeat(33)}`])("rejects malformed IV %s", (iv) => {
        const content = [
            `#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example/key.bin",IV=${iv}`,
            "#EXTINF:1,",
            "https://cdn.example/0.ts",
        ].join("\n");

        expect(() => parseMediaPlaylist({ content })).toThrow(new HLSParseError("Invalid IV for encryption key"));
    });

    test("warns once and treats unsupported encryption methods as plain segments", () => {
        const warning = jest.spyOn(logger, "warning").mockImplementation(() => undefined);
        const playlist = parseMediaPlaylist({
            content: [
                "#EXTM3U",
                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="first.key"',
                "#EXTINF:1,",
                "https://cdn.example/0.ts",
                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="second.key"',
                "#EXTINF:1,",
                "https://cdn.example/1.ts",
            ].join("\n"),
        });

        expect(playlist.segments).toHaveLength(2);
        expect(playlist.segments.every((segment) => !segment.encryption)).toBe(true);
        expect(warning).toHaveBeenCalledTimes(1);
        expect(warning).toHaveBeenCalledWith(
            'Unsupported encryption method: "SAMPLE-AES". Chunks will not be decrypted.'
        );
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
