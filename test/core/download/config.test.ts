import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { normalizeDownloaderConfig } from "@/core/download/config";

describe("download configuration", () => {
    test("uses the current working directory as the default temporary base path", () => {
        expect(normalizeDownloaderConfig().tempPath).toBe(path.resolve("."));
    });

    test("removes recognized video extensions from the output basename", () => {
        for (const extension of ["ts", "mkv", "mp4", "webm", "mov", "avi", "m2ts"]) {
            expect(normalizeDownloaderConfig({ output: `./episode.final.${extension}` }).outputBasePath).toBe(
                path.join(".", "episode.final")
            );
        }
    });

    test("preserves unknown suffixes and defaults to an extensionless basename", () => {
        expect(normalizeDownloaderConfig({ output: "./episode.release" }).outputBasePath).toBe("./episode.release");
        expect(normalizeDownloaderConfig().outputBasePath).toBe("./output");
    });

    test("matches recognized video extensions case-insensitively", () => {
        expect(normalizeDownloaderConfig({ output: "./episode.MP4" }).outputBasePath).toBe("episode");
    });

    test("normalizes source and task attempt policies independently", () => {
        expect(normalizeDownloaderConfig({ sourceRequestAttempts: 2, taskAttempts: 3 })).toMatchObject({
            sourceRequestAttempts: 2,
            taskAttempts: 3,
        });
        expect(normalizeDownloaderConfig()).toMatchObject({
            sourceRequestAttempts: 5,
            taskAttempts: 5,
        });
    });

    test.each([
        [{ threads: 0 }, "thread count"],
        [{ sourceRequestAttempts: 0 }, "Source request attempt count"],
        [{ taskAttempts: 0 }, "Task attempt count"],
    ] as const)("rejects invalid execution policy %p", (config, message) => {
        expect(() => normalizeDownloaderConfig(config)).toThrow(message);
    });
});
