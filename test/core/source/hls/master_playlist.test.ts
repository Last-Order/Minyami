import { describe, expect, test } from "@jest/globals";
import { parseMasterPlaylist } from "../../../../src/core/source/hls/master_playlist";
import { HLSParseError, HLSPlaylistKind } from "../../../../src/core/source/hls/parser";

describe("parseMasterPlaylist", () => {
    test("parses variant locations and attributes", () => {
        const playlist = parseMasterPlaylist({
            content: [
                "#EXTM3U",
                '#EXT-X-STREAM-INF:BANDWIDTH=1280000,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=29.97',
                "",
                "# variant comment",
                "video/720p.m3u8",
                "#EXT-X-STREAM-INF:BANDWIDTH=2560000",
                "https://media.example/high.m3u8",
            ].join("\n"),
            playlistUrl: "https://media.example/master/index.m3u8",
        });

        expect(playlist).toEqual({
            kind: HLSPlaylistKind.Master,
            variants: [
                {
                    url: "https://media.example/master/video/720p.m3u8",
                    bandwidth: 1280000,
                    codecs: "avc1.4d401f,mp4a.40.2",
                    resolution: { width: 1280, height: 720 },
                    frameRate: 29.97,
                },
                {
                    url: "https://media.example/high.m3u8",
                    bandwidth: 2560000,
                },
            ],
        });
    });

    test.each([
        {
            name: "a variant without BANDWIDTH",
            content: ["#EXT-X-STREAM-INF:RESOLUTION=1280x720", "https://media.example/720p.m3u8"].join("\n"),
            expectedMessage: "Missing BANDWIDTH attribute for streams.",
        },
        {
            name: "a variant without a URI",
            content: "#EXT-X-STREAM-INF:BANDWIDTH=1280000\n",
            expectedMessage: "Invalid HLS playlist.",
        },
        {
            name: "a relative variant URI without a playlist URL",
            content: ["#EXT-X-STREAM-INF:BANDWIDTH=1280000", "720p.m3u8"].join("\n"),
            expectedMessage: "Missing base URL for HLS playlist.",
        },
    ])("rejects $name", ({ content, expectedMessage }) => {
        expect(() => parseMasterPlaylist({ content })).toThrow(new HLSParseError(expectedMessage));
    });
});
