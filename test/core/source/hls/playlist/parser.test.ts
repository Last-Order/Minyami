import { describe, expect, test } from "@jest/globals";
import { HLSPlaylistKind, parseHLSPlaylist } from "../../../../../src/core/source/hls/playlist/parser";

describe("parseHLSPlaylist", () => {
    test("returns a master playlist for a variant tag", () => {
        const playlist = parseHLSPlaylist({
            content: ["#EXTM3U", "#EXT-X-STREAM-INF:BANDWIDTH=1280000", "https://media.example/high.m3u8"].join("\n"),
        });

        expect(playlist.kind).toBe(HLSPlaylistKind.Master);
    });

    test("returns a media playlist when variant text is not a tag", () => {
        const playlist = parseHLSPlaylist({
            content: [
                "#EXTM3U",
                "# comment mentioning #EXT-X-STREAM-INF",
                "#EXTINF:1,",
                "https://media.example/0.ts",
            ].join("\n"),
        });

        expect(playlist.kind).toBe(HLSPlaylistKind.Media);
    });
});
