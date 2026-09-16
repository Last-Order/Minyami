import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { CliOptions, normalizeCliArguments } from "@/cli/arguments";
import type { Erii } from "@/cli/erii";
import { configureCli } from "@/cli/program";

// Only stub terminal layout: clui uses legacy escapes rejected by Jest's strict wrapper.
jest.mock("clui", () => ({
    Line: class {
        padding() {
            return this;
        }
        column() {
            return this;
        }
        output() {
            return this;
        }
    },
}));

// Exercise Erii itself, including token parsing, validation, aliases, and option conversion.
const EriiConstructor = (require("erii") as { Erii: new () => Erii<CliOptions> }).Erii;

describe("CLI command parsing", () => {
    const originalArgv = process.argv;
    const download = jest.fn<(sourcePath: string, options: CliOptions) => Promise<void>>();

    beforeEach(() => {
        download.mockReset().mockResolvedValue(undefined);
        jest.spyOn(console, "log").mockImplementation(() => undefined);
        jest.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        process.argv = originalArgv;
    });

    function run(args: string[]) {
        // argv contains shell-tokenized values, so paths and headers with spaces stay single arguments.
        process.argv = [originalArgv[0], "minyami", ...normalizeCliArguments(args)];
        const cli = new EriiConstructor();
        configureCli(cli, download);
        cli.setMetaInfo({ name: "Minyami", version: "test-version" });
        cli.okite();
    }

    function parsedOptions(): CliOptions {
        expect(download).toHaveBeenCalledTimes(1);
        expect(console.error).not.toHaveBeenCalled();
        return download.mock.calls[0][1];
    }

    test.each([
        ["https://example.com/video.m3u8?token=abc&quality=1080"],
        ["./my video.m3u8"],
        ["C:\\Videos\\my video.m3u8"],
        ["--download", "video.m3u8"],
        ["-d", "video.m3u8"],
    ])("routes command %j to a download with no explicit options", (...args) => {
        run(args);
        expect({ ...parsedOptions() }).toEqual({});
        expect(download.mock.calls[0][0]).toBe(args[args.length - 1]);
    });

    test.each(["--output", "-o"])("parses %s and numeric options", (outputFlag) => {
        run(["video.m3u8", outputFlag, "my output", "--threads", "8", "--retries", "3"]);
        expect({ ...parsedOptions() }).toEqual({ output: "my output", threads: 8, retries: 3 });
    });

    test.each([
        ["--verbose", "verbose"],
        ["--debug", "verbose"],
        ["--live", "live"],
        ["--no-proxy", "noProxy"],
        ["--no-merge", "noMerge"],
        ["--keep", "keep"],
        ["-k", "keep"],
        ["--keep-encrypted-chunks", "keepEncryptedChunks"],
    ])("parses %s as the boolean option %s", (flag, property) => {
        run(["video.m3u8", flag]);
        const options = parsedOptions();
        expect(options[property]).toBe(true);
        expect(Object.keys(options)).toHaveLength(1);
    });

    test("preserves string values and exposes kebab-case options to the download handler", () => {
        run([
            "video.m3u8",
            "--temp-dir",
            "C:\\Temp\\my chunks",
            "--cookies",
            "session=abc; quality=high",
            "--proxy",
            "socks5://127.0.0.1:1080",
            "--slice",
            "01:02:03-01:04:05",
            "--key",
            "001122aabbcc",
        ]);
        const options = parsedOptions();
        expect(options.tempDir).toBe("C:\\Temp\\my chunks");
        expect(options.cookies).toBe("session=abc; quality=high");
        expect(options.proxy).toBe("socks5://127.0.0.1:1080");
        expect(options.slice).toBe("01:02:03-01:04:05");
        expect(options.key).toBe("001122aabbcc");
    });

    test.each(["--headers", "-H"])("preserves single and repeated %s values", (flag) => {
        run(["video.m3u8", flag, "User-Agent: example player"]);
        expect(parsedOptions().headers).toBe("User-Agent: example player");
        download.mockClear();
        run(["video.m3u8", flag, "User-Agent: example player", flag, "Cookie: session=abc"]);
        expect(parsedOptions().headers).toEqual(["User-Agent: example player", "Cookie: session=abc"]);
    });

    test("preserves repeated keys in command order", () => {
        run(["-d", "video.m3u8", "--key", "first:key-a", "--key", "key-b"]);
        expect(parsedOptions().key).toEqual(["first:key-a", "key-b"]);
    });

    test("accepts options before an explicit download command", () => {
        run(["--debug", "--threads", "8", "-d", "video.m3u8", "--live"]);
        expect({ ...parsedOptions() }).toEqual({ verbose: true, threads: 8, live: true });
        expect(download.mock.calls[0][0]).toBe("video.m3u8");
    });

    test.each([
        ["--threads", "many", "threads"],
        ["--threads", "1.5", "threads"],
        ["--retries", "many", "retries"],
        ["--retries", "1.5", "retries"],
        ["--output", "bad?name", "output"],
        ["--slice", "01:00", "slice"],
        ["--slice", "bad-02:00", "slice"],
        ["--slice", "01:00-bad", "slice"],
    ])("reports and omits invalid option %s %s", (flag, value, property) => {
        run(["video.m3u8", flag, value, "--live"]);
        // Erii reports invalid options but still invokes the command with the remaining valid options.
        expect(download).toHaveBeenCalledTimes(1);
        expect({ ...download.mock.calls[0][1] }).toEqual({ live: true });
        expect(download.mock.calls[0][1][property]).toBeUndefined();
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Argument validation failed for option"));
    });

    test.each([[], ["--help"], ["-h"], ["help"]])("shows help for %j without downloading", (...args) => {
        run(args);
        expect(download).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Help:"));
        expect(console.error).not.toHaveBeenCalled();
    });

    test.each(["--version", "version"])("shows version for %s without downloading", (command) => {
        run([command]);
        expect(download).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith("Minyami / test-version");
        expect(console.error).not.toHaveBeenCalled();
    });
});
