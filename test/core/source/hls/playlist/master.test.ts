import { describe, expect, test } from "@jest/globals";
import { parseMasterPlaylist } from "@/core/source/hls/playlist/master";
import { HLSParseError, HLSPlaylistKind } from "@/core/source/hls/playlist/parser";

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
            audioRenditions: [],
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

    test("parses external and multiplexed audio renditions and links their group to variants", () => {
        const playlist = parseMasterPlaylist({
            content: [
                "#EXTM3U",
                '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="2",URI="audio/en.m3u8"',
                '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="stereo",NAME="Japanese",LANGUAGE="ja",DEFAULT=NO,AUTOSELECT=YES',
                '#EXT-X-STREAM-INF:BANDWIDTH=2560000,AUDIO="stereo",RESOLUTION=1920x1080',
                "video/high.m3u8",
            ].join("\n"),
            playlistUrl: "https://media.example/master/index.m3u8",
        });

        expect(playlist).toEqual({
            kind: HLSPlaylistKind.Master,
            audioRenditions: [
                {
                    groupId: "stereo",
                    name: "English",
                    url: "https://media.example/master/audio/en.m3u8",
                    language: "en",
                    channels: 2,
                    isDefault: true,
                    autoSelect: true,
                },
                {
                    groupId: "stereo",
                    name: "Japanese",
                    language: "ja",
                    isDefault: false,
                    autoSelect: true,
                },
            ],
            variants: [
                {
                    url: "https://media.example/master/video/high.m3u8",
                    bandwidth: 2560000,
                    audioGroupId: "stereo",
                    resolution: { width: 1920, height: 1080 },
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
        {
            name: "a referenced audio group without renditions",
            content: ['#EXT-X-STREAM-INF:BANDWIDTH=1280000,AUDIO="missing"', "https://media.example/720p.m3u8"].join(
                "\n"
            ),
            expectedMessage: "Missing audio renditions for group missing.",
        },
        {
            name: "an audio rendition without a name",
            content: [
                '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="https://media.example/audio.m3u8"',
                "#EXT-X-STREAM-INF:BANDWIDTH=1280000",
                "https://media.example/720p.m3u8",
            ].join("\n"),
            expectedMessage: "Missing GROUP-ID or NAME for HLS audio rendition.",
        },
    ])("rejects $name", ({ content, expectedMessage }) => {
        expect(() => parseMasterPlaylist({ content })).toThrow(new HLSParseError(expectedMessage));
    });
});
