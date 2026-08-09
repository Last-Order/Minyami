import { describe, expect, jest, test } from "@jest/globals";
import { createDownloader } from "../../../src/core/download/downloader";
import { DownloadHttpClient } from "../../../src/core/download/http_client";
import { DownloadSource } from "../../../src/core/source/types";
import { withTempDirectory } from "../../helpers/filesystem";

describe("download encryption validation", () => {
    test.each([
        ["invalid key", "z".repeat(32), "1", "AES-128 key"],
        ["invalid IV", "00".repeat(16), "xy", "AES-128-CBC IV"],
    ])("rejects an %s before downloading media", async (_name, key, iv, message) => {
        await withTempDirectory("minyami-encryption-validation-", async (directory) => {
            const download = jest.spyOn(DownloadHttpClient.prototype, "download");
            const source: DownloadSource = {
                sourcePath: "custom://invalid-encryption",
                continuous: false,
                async prepare(context) {
                    context.keys.set("test:key", key);
                    return { tracks: [{ id: "main", type: "video", sourcePath: this.sourcePath }] };
                },
                async *discover() {
                    yield {
                        trackId: "main",
                        items: [
                            {
                                url: "http://127.0.0.1/unused.ts",
                                kind: "media",
                                duration: 1,
                                encryption: { scheme: "aes-128-cbc", keyId: "test:key", iv },
                            },
                        ],
                        totalItemCount: 1,
                    };
                },
            };
            const downloader = createDownloader(source, { noMerge: true, tempDir: directory });

            await expect(downloader.download()).rejects.toThrow(message);
            expect(download).not.toHaveBeenCalled();
        });
    });
});
