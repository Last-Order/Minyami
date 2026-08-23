import { describe, expect, jest, test } from "@jest/globals";
import { createDownloader } from "../../../../src/core/download/downloader";
import { DownloadHttpClient } from "../../../../src/core/download/infrastructure/http_client";
import { MP4_CONTAINER, MPEG_TS_CONTAINER } from "../../../../src/core/media_container";
import { DownloadSource } from "../../../../src/core/source/types";
import { withTempDirectory } from "../../../helpers/filesystem";

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
                    return {
                        container: MPEG_TS_CONTAINER,
                        tracks: [
                            {
                                id: "main",
                                mediaTrack: { id: "logical-main", type: "video" },
                                sourcePath: this.sourcePath,
                            },
                        ],
                    };
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

    test("rejects invalid SAMPLE-AES metadata before downloading media", async () => {
        await withTempDirectory("minyami-sample-aes-validation-", async (directory) => {
            const download = jest.spyOn(DownloadHttpClient.prototype, "download");
            const source: DownloadSource = {
                sourcePath: "custom://invalid-sample-aes",
                continuous: false,
                async prepare(context) {
                    context.keys.set("skd://test", "00".repeat(16));
                    return {
                        container: MPEG_TS_CONTAINER,
                        tracks: [
                            {
                                id: "main",
                                mediaTrack: { id: "logical-main", type: "video" },
                                sourcePath: this.sourcePath,
                            },
                        ],
                    };
                },
                async *discover() {
                    yield {
                        trackId: "main",
                        items: [
                            {
                                url: "http://127.0.0.1/unused.ts",
                                kind: "media",
                                duration: 1,
                                encryption: {
                                    scheme: "mpeg-ts-sample-aes",
                                    keyId: "skd://test",
                                    iv: "invalid",
                                },
                            },
                        ],
                        totalItemCount: 1,
                    };
                },
            };
            const downloader = createDownloader(source, { noMerge: true, tempDir: directory });

            await expect(downloader.download()).rejects.toThrow("SAMPLE-AES IV");
            expect(download).not.toHaveBeenCalled();
        });
    });

    test("rejects malformed fMP4 SAMPLE-AES fragments-info before downloading", async () => {
        await withTempDirectory("minyami-fmp4-sample-aes-validation-", async (directory) => {
            const download = jest.spyOn(DownloadHttpClient.prototype, "download");
            const source: DownloadSource = {
                sourcePath: "custom://invalid-fmp4-sample-aes",
                continuous: false,
                async prepare(context) {
                    context.keys.set("test:key", "00".repeat(16));
                    return {
                        container: MP4_CONTAINER,
                        tracks: [
                            {
                                id: "main",
                                mediaTrack: { id: "logical-main", type: "video" },
                                sourcePath: this.sourcePath,
                            },
                        ],
                    };
                },
                async *discover() {
                    yield {
                        trackId: "main",
                        items: [
                            {
                                url: "http://127.0.0.1/unused.m4s",
                                kind: "media",
                                duration: 1,
                                encryption: {
                                    scheme: "iso-bmff-sample-aes",
                                    operation: "fragment",
                                    keys: [{ selector: "1", keyId: "test:key" }],
                                    fragmentsInfoBase64: "invalid",
                                },
                            },
                        ],
                        totalItemCount: 1,
                    };
                },
            };
            const downloader = createDownloader(source, { noMerge: true, tempDir: directory });

            await expect(downloader.download()).rejects.toThrow("base64-encoded fragments-info");
            expect(download).not.toHaveBeenCalled();
        });
    });

    test("rejects an invalid protocol-neutral output prefix before downloading", async () => {
        await withTempDirectory("minyami-output-prefix-validation-", async (directory) => {
            const download = jest.spyOn(DownloadHttpClient.prototype, "download");
            const source: DownloadSource = {
                sourcePath: "custom://invalid-output-prefix",
                continuous: false,
                async prepare() {
                    return {
                        container: MPEG_TS_CONTAINER,
                        tracks: [
                            {
                                id: "main",
                                mediaTrack: { id: "logical-main", type: "video" },
                                sourcePath: this.sourcePath,
                            },
                        ],
                    };
                },
                async *discover() {
                    yield {
                        trackId: "main",
                        items: [
                            {
                                url: "http://127.0.0.1/unused.bin",
                                kind: "media",
                                duration: 1,
                                output: { replayablePrefix: { slot: "", identity: "fixture" } },
                            },
                        ],
                        totalItemCount: 1,
                    };
                },
            };
            const downloader = createDownloader(source, { noMerge: true, tempDir: directory });

            await expect(downloader.download()).rejects.toThrow("prefix slot");
            expect(download).not.toHaveBeenCalled();
        });
    });
});
