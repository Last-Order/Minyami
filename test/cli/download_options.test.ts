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
});
