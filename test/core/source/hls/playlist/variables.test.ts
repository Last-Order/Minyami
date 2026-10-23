import { describe, expect, test } from "@jest/globals";
import { parseMasterPlaylist } from "@/core/source/hls/playlist/master";
import { parseMediaPlaylist } from "@/core/source/hls/playlist/media";
import { HLSParseError, HLSParseOptions, parseHLSPlaylist } from "@/core/source/hls/playlist/parser";

describe("HLS playlist variables", () => {
    const playlistUrl = "https://manifest.example/master/index.m3u8";

    test("resolves master variant and audio URLs and quoted metadata before URL resolution", () => {
        const playlist = parseMasterPlaylist({
            playlistUrl,
            content: [
                "#EXTM3U",
                '#EXT-X-DEFINE:NAME="prefix",VALUE="https://media.example/"',
                '#EXT-X-DEFINE:NAME="session",VALUE="session-123"',
                '#EXT-X-DEFINE:NAME="group",VALUE="english"',
                '#EXT-X-DEFINE:NAME="empty",VALUE=""',
                '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="{$group}",NAME="EN",URI="{$prefix}audio.m3u8?asid={$session}"',
                '#EXT-X-STREAM-INF:BANDWIDTH=6000000,AUDIO="{$group}"',
                "{$prefix}1080p.m3u8?asid={$session}{$empty}",
            ].join("\n"),
        });

        expect(playlist.variants[0]).toMatchObject({
            url: "https://media.example/1080p.m3u8?asid=session-123",
            audioGroupId: "english",
        });
        expect(playlist.audioRenditions[0]).toMatchObject({
            url: "https://media.example/audio.m3u8?asid=session-123",
            groupId: "english",
        });
        expect(playlist.variables).toEqual({
            prefix: "https://media.example/",
            session: "session-123",
            group: "english",
            empty: "",
        });
        expect(Object.isFrozen(playlist.variables)).toBe(true);
    });

    test("imports only declared parent variables and resolves segment, map, key, byte range, and IV values", () => {
        const parentVariables = Object.freeze({ prefix: "https://cdn.example/", session: "abc", unused: "parent" });
        const playlist = parseMediaPlaylist({
            playlistUrl,
            parentVariables,
            content: [
                '#EXT-X-DEFINE:IMPORT="prefix"',
                '#EXT-X-DEFINE:IMPORT="session"',
                '#EXT-X-DEFINE:NAME="range",VALUE="4@0"',
                '#EXT-X-DEFINE:NAME="iv",VALUE="0x01"',
                '#EXT-X-KEY:METHOD=AES-128,URI="{$prefix}key?asid={$session}",IV={$iv}',
                '#EXT-X-MAP:URI="{$prefix}init.mp4?asid={$session}",BYTERANGE="{$range}"',
                "#EXTINF:1,",
                "{$prefix}0.m4s?asid={$session}",
                "#EXT-X-ENDLIST",
            ].join("\n"),
        });

        expect(playlist.segments.map((segment) => segment.url)).toEqual([
            "https://cdn.example/init.mp4?asid=abc",
            "https://cdn.example/0.m4s?asid=abc",
        ]);
        expect(playlist.segments[0]).toMatchObject({
            byteRange: { offset: 0, length: 4 },
            encryption: { iv: "01", key: { url: "https://cdn.example/key?asid=abc" } },
        });
        expect(parentVariables).toEqual({ prefix: "https://cdn.example/", session: "abc", unused: "parent" });
    });

    test("expands references to preceding variables in subsequent definitions", () => {
        const playlist = parseMediaPlaylist({
            playlistUrl,
            content: [
                '#EXT-X-DEFINE:NAME="root",VALUE="../"',
                '#EXT-X-DEFINE:NAME="prefix",VALUE="{$root}segments/"',
                "#EXTINF:1,",
                "{$prefix}0.ts",
            ].join("\n"),
        });

        expect(playlist.segments[0].url).toBe("https://manifest.example/segments/0.ts");
    });

    test("does not recursively expand replacement values", () => {
        const playlist = parseMediaPlaylist({
            playlistUrl,
            parentVariables: { first: "{$second}", second: "expanded" },
            content: [
                '#EXT-X-DEFINE:IMPORT="first"',
                '#EXT-X-DEFINE:IMPORT="second"',
                "#EXTINF:1,",
                "{$first}.ts",
            ].join("\n"),
        });

        expect(playlist.segments[0].url).toBe(new URL("{$second}.ts", playlistUrl).href);
    });

    test.each([
        { query: "token=a%2Fb+c%252F", expected: "a/b+c%2F" },
        { query: "%74oken=value", expected: "value" },
        { query: "token=", expected: "" },
    ])("percent-decodes QUERYPARAM values once: $query", ({ query, expected }) => {
        const playlist = parseMediaPlaylist({
            playlistUrl: `${playlistUrl}?${query}`,
            content: ['#EXT-X-DEFINE:QUERYPARAM="token"', "#EXTINF:1,", "0.ts?token={$token}"].join("\n"),
        });

        expect(playlist.segments[0].url).toBe(`https://manifest.example/master/0.ts?token=${expected}`);
    });

    test("accepts prototype-like names only when they were explicitly declared", () => {
        const playlist = parseMasterPlaylist({
            playlistUrl,
            content: [
                '#EXT-X-DEFINE:NAME="__proto__",VALUE="video"',
                "#EXT-X-STREAM-INF:BANDWIDTH=1000",
                "{$__proto__}.m3u8",
            ].join("\n"),
        });

        expect(playlist.variants[0].url).toBe("https://manifest.example/master/video.m3u8");
        expect(playlist.variables?.["__proto__"]).toBe("video");
    });

    test("ignores references inside comments and unsupported tags", () => {
        const playlist = parseMediaPlaylist({
            playlistUrl,
            content: [
                '# comment containing "{$missing}"',
                '#EXT-X-UNKNOWN:URI="{$missing}"',
                "#EXTINF:1,{$missing}",
                "0.ts",
            ].join("\n"),
        });

        expect(playlist.segments[0].url).toBe("https://manifest.example/master/0.ts");
    });

    test("ignores references in unsupported attributes of a recognized tag", () => {
        const playlist = parseMasterPlaylist({
            playlistUrl,
            content: ['#EXT-X-STREAM-INF:BANDWIDTH=1000,X-UNKNOWN="{$missing}"', "video.m3u8"].join("\n"),
        });

        expect(playlist.variants[0].url).toBe("https://manifest.example/master/video.m3u8");
    });

    test.each<{ name: string; content: string[]; options?: Partial<HLSParseOptions>; error: string }>([
        { name: "undefined reference", content: ["#EXTINF:1,", "{$missing}.ts"], error: "Undefined HLS variable" },
        {
            name: "reference before declaration",
            content: ["#EXTINF:1,", "{$later}.ts", '#EXT-X-DEFINE:NAME="later",VALUE="0"'],
            error: "Undefined HLS variable",
        },
        {
            name: "case-mismatched reference",
            content: ['#EXT-X-DEFINE:NAME="Token",VALUE="0"', "#EXTINF:1,", "{$token}.ts"],
            error: "Undefined HLS variable",
        },
        {
            name: "unimported parent variable",
            options: { parentVariables: { token: "secret" } },
            content: ["#EXTINF:1,", "{$token}.ts"],
            error: "Undefined HLS variable",
        },
        { name: "missing parent", content: ['#EXT-X-DEFINE:IMPORT="token"'], error: "Missing parent HLS variable" },
        {
            name: "inherited object property",
            options: { parentVariables: {} },
            content: ['#EXT-X-DEFINE:IMPORT="constructor"'],
            error: "Missing parent HLS variable",
        },
        {
            name: "IMPORT in a master playlist",
            options: { parentVariables: { token: "value" } },
            content: ['#EXT-X-DEFINE:IMPORT="token"', "#EXT-X-STREAM-INF:BANDWIDTH=1000", "video.m3u8"],
            error: "IMPORT is only allowed in media playlists",
        },
        {
            name: "duplicate declaration",
            content: ['#EXT-X-DEFINE:NAME="token",VALUE="a"', '#EXT-X-DEFINE:NAME="token",VALUE="b"'],
            error: "Duplicate HLS variable",
        },
        {
            name: "duplicate import and local declaration",
            options: { parentVariables: { token: "a" } },
            content: ['#EXT-X-DEFINE:IMPORT="token"', '#EXT-X-DEFINE:NAME="token",VALUE="b"'],
            error: "Duplicate HLS variable",
        },
        {
            name: "invalid name",
            content: ['#EXT-X-DEFINE:NAME="bad.name",VALUE="a"'],
            error: "Invalid HLS variable name",
        },
        { name: "empty name", content: ['#EXT-X-DEFINE:NAME="",VALUE="a"'], error: "Invalid HLS variable name" },
        { name: "missing value", content: ['#EXT-X-DEFINE:NAME="token"'], error: "Missing VALUE" },
        { name: "missing selector", content: ['#EXT-X-DEFINE:VALUE="a"'], error: "requires exactly one" },
        {
            name: "conflicting selectors",
            content: ['#EXT-X-DEFINE:NAME="token",VALUE="a",IMPORT="token"'],
            error: "requires exactly one",
        },
        {
            name: "missing query parameter",
            content: ['#EXT-X-DEFINE:QUERYPARAM="token"'],
            error: "Missing query parameter",
        },
        {
            name: "query parameter without an associated value",
            options: { playlistUrl: `${playlistUrl}?token` },
            content: ['#EXT-X-DEFINE:QUERYPARAM="token"'],
            error: "Missing query parameter",
        },
        ...["%22", "%0A", "%0D", "%XX"].map((value) => ({
            name: `invalid query parameter ${value}`,
            options: { playlistUrl: `${playlistUrl}?token=${value}` },
            content: ['#EXT-X-DEFINE:QUERYPARAM="token"'],
            error: "Invalid query parameter",
        })),
    ])("rejects $name", ({ content, options, error }) => {
        const parse = () => parseHLSPlaylist({ playlistUrl, ...options, content: content.join("\n") });
        expect(parse).toThrow(HLSParseError);
        expect(parse).toThrow(error);
    });
});
