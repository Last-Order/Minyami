import { describe, expect, test } from "@jest/globals";
import { createCliDownloadConfiguration, mergeCliOptions } from "@/cli/download_options";

describe("CLI download options", () => {
    test("applies config-file defaults without mutating parser options", () => {
        const options = Object.freeze({ threads: undefined, output: "command-output", live: true });
        const fileOptions = Object.freeze({ threads: 8, output: "config-output", unknown: "ignored later" });

        expect(mergeCliOptions(options, fileOptions)).toEqual({
            threads: 8,
            output: "command-output",
            live: true,
            unknown: "ignored later",
        });
        expect(options).toEqual({ threads: undefined, output: "command-output", live: true });
    });

    test("maps CLI names and the shared retry setting to core options", () => {
        const config = createCliDownloadConfiguration({
            live: true,
            slice: "01:00-02:00",
            retries: 3,
            keep: true,
            key: ["first:key-a", "key-b"],
            unknown: "do not forward",
        });

        expect(config.live).toBe(true);
        expect(config.slice).toBe("01:00-02:00");
        expect(config.downloader).toMatchObject({
            sourceRequestAttempts: 3,
            taskAttempts: 3,
            keepTemporaryFiles: true,
            explicitKeys: [{ kid: "first", key: "key-a" }, { key: "key-b" }],
        });
        expect(config.downloader).not.toHaveProperty("unknown");
        expect(config.downloader.streamSelector).toBeInstanceOf(Function);
    });

    test("validates the merged values so explicit CLI options can replace invalid defaults", () => {
        expect(
            mergeCliOptions(
                { verbose: false, noProxy: false, threads: 4 },
                { verbose: "true", noProxy: "false", threads: "8" },
            ),
        ).toEqual({ verbose: false, noProxy: false, threads: 4 });
    });

    test.each([
        ["verbose", "true"],
        ["noProxy", "false"],
        ["threads", 0],
        ["retries", 1.5],
        ["output", 123],
        ["headers", [123]],
        ["key", null],
    ])("rejects an invalid merged %s option", (key, value) => {
        expect(() => mergeCliOptions({}, { [key]: value })).toThrow(`Option ${key} must be`);
    });
});
