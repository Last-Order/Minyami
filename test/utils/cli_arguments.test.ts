import { describe, expect, test } from "@jest/globals";
import { normalizeCliArguments } from "@/utils/cli_arguments";

describe("normalizeCliArguments", () => {
    test.each(["https://example.com/video.m3u8", "./video.m3u8", "C:\\Videos\\my video.m3u8"])(
        "routes input %s to the download command",
        (input) => {
            expect(normalizeCliArguments([input])).toEqual(["--download", input]);
        },
    );

    test("preserves options, repeated values, and the caller's arguments", () => {
        const args = Object.freeze([
            "https://example.com/live.m3u8",
            "--live",
            "-o",
            "my output",
            "--threads",
            "8",
            "-H",
            "Cookie: session=abc",
            "-H",
            "User-Agent: example",
        ]);
        expect(normalizeCliArguments(args)).toEqual(["--download", ...args]);
    });

    test.each([
        [],
        [""],
        ["-d", "video.m3u8"],
        ["--download", "video.m3u8", "--live"],
        ["--help"],
        ["-h", "download"],
        ["--version"],
        ["help"],
        ["h"],
        ["version"],
        ["download"],
        ["d"],
        ["--live", "video.m3u8"],
        ["video.m3u8", "--help"],
        ["video.m3u8", "--version"],
        ["video.m3u8", "-d", "explicit.m3u8"],
        ["video.m3u8", "--download", "explicit.m3u8"],
    ])("preserves existing command arguments %j", (...args) => {
        expect(normalizeCliArguments(args)).toEqual(args);
    });
});
