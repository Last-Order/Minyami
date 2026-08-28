import { describe, expect, test } from "@jest/globals";
import { HLSPlaylistKind, parseHLSPlaylist } from "@/core/source/hls/playlist/parser";

describe("parseHLSPlaylist", () => {
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
