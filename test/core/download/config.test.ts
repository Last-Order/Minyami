import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { normalizeDownloaderConfig } from "../../../src/core/download/config";
import { DownloadRuntime } from "../../../src/core/download/runtime";
import { withTempDirectory } from "../../helpers/filesystem";

describe("download configuration", () => {
    test("uses the current working directory as the default temporary base path", () => {
        expect(normalizeDownloaderConfig().tempPath).toBe(path.resolve("."));
    });

    test("preserves the generated temporary workspace naming strategy", async () => {
        await withTempDirectory("minyami-runtime-", async (directory) => {
            const runtime = new DownloadRuntime({
                output: path.join(directory, "output.ts"),
                tempDir: directory,
            });

            await runtime.allocateWorkspace();

            expect(path.dirname(runtime.tempPath)).toBe(path.resolve(directory));
            expect(path.basename(runtime.tempPath)).toMatch(/^minyami_\d+_[0-9a-f]{8}$/);
        });
    });

    test.each(["ts", "mkv", "mp4", "webm", "mov", "avi", "m2ts"])(
        "removes a recognized .%s video extension from the output basename",
        (extension) => {
            expect(normalizeDownloaderConfig({ output: `./episode.final.${extension}` }).outputBasePath).toBe(
                path.join(".", "episode.final")
            );
        }
    );

    test("preserves unknown suffixes and defaults to an extensionless basename", () => {
        expect(normalizeDownloaderConfig({ output: "./episode.release" }).outputBasePath).toBe("./episode.release");
        expect(normalizeDownloaderConfig().outputBasePath).toBe("./output");
    });

    test("matches recognized video extensions case-insensitively", () => {
        expect(normalizeDownloaderConfig({ output: "./episode.MP4" }).outputBasePath).toBe("episode");
    });
});
