import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { describe, expect, jest, test } from "@jest/globals";
import { createDownloader } from "@/core/download/downloader";
import { SystemMp4DecryptRunner } from "@/core/download/encryption/sample_aes/iso_bmff/runner";
import { createHLSSource } from "@/core/source/hls";
import { withTempDirectory } from "../../../helpers/filesystem";
import { close, listen } from "../../../helpers/http";
import {
    createClearInitialization,
    createMediaFragment,
    createProtectedInitialization,
} from "../../../helpers/isobmff";

describe("fMP4 SAMPLE-AES HLS", () => {
    test("reports protected multi-DRM content when no explicit key is provided", async () => {
        await withTempDirectory("minyami-fmp4-sample-aes-protected-", async (directory) => {
            const protectedInitialization = createProtectedInitialization();
            let mediaRequestCount = 0;
            const server = http.createServer((request, response) => {
                switch (request.url) {
                    case "/playlist.m3u8":
                        response.end(
                            [
                                "#EXTM3U",
                                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://asset",KEYFORMAT="com.apple.streamingkeydelivery"',
                                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,cGxheXJlYWR5",KEYFORMAT="com.microsoft.playready"',
                                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,d2lkZXZpbmU=",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"',
                                '#EXT-X-MAP:URI="/init.mp4"',
                                "#EXTINF:1,",
                                "/0.m4s",
                                "#EXT-X-ENDLIST",
                            ].join("\n"),
                        );
                        break;
                    case "/init.mp4":
                        response.end(protectedInitialization);
                        break;
                    case "/0.m4s":
                        mediaRequestCount++;
                        response.end(createMediaFragment("protected"));
                        break;
                    default:
                        response.writeHead(404).end();
                }
            });
            const baseUrl = await listen(server);

            try {
                const source = createHLSSource(`${baseUrl}/playlist.m3u8`, { mode: "snapshot" });
                const downloader = createDownloader(source, {
                    output: path.join(directory, "media.mp4"),
                    tempDir: directory,
                });

                await expect(downloader.download()).rejects.toThrow(
                    "This HLS content is protected. Provide an explicit decryption key.",
                );
                expect(mediaRequestCount).toBe(0);
            } finally {
                await close(server);
            }
        });
    });

    test("decrypts fragments concurrently and writes their clear bytes in playlist order", async () => {
        await withTempDirectory("minyami-fmp4-sample-aes-", async (directory) => {
            const protectedInitialization = createProtectedInitialization();
            const clearInitialization = createClearInitialization();
            const firstFragment = createMediaFragment("first");
            const secondFragment = createMediaFragment("second");
            const completions: string[] = [];
            let releaseFirstFragment!: () => void;
            const firstFragmentRelease = new Promise<void>((resolve) => {
                releaseFirstFragment = resolve;
            });
            let notifySecondFragmentCompleted!: () => void;
            const secondFragmentCompleted = new Promise<void>((resolve) => {
                notifySecondFragmentCompleted = resolve;
            });
            const runner = jest
                .spyOn(SystemMp4DecryptRunner.prototype, "run")
                .mockImplementation(async (arguments_) => {
                    const input = arguments_.at(-2)!;
                    const output = arguments_.at(-1)!;
                    const isFragment = arguments_.includes("--fragments-info");
                    if (isFragment && input.includes("000001_0.m4s")) {
                        await firstFragmentRelease;
                    }
                    fs.writeFileSync(output, isFragment ? fs.readFileSync(input) : clearInitialization);
                    completions.push(path.basename(input));
                    if (input.includes("000002_1.m4s")) {
                        notifySecondFragmentCompleted();
                    }
                    return { stderr: "" };
                });

            const server = http.createServer((request, response) => {
                switch (request.url) {
                    case "/playlist.m3u8":
                        response.end(
                            [
                                "#EXTM3U",
                                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://asset",KEYFORMAT="com.apple.streamingkeydelivery"',
                                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,cGxheXJlYWR5",KEYFORMAT="com.microsoft.playready"',
                                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="data:text/plain;base64,d2lkZXZpbmU=",KEYFORMAT="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"',
                                '#EXT-X-MAP:URI="/init.mp4"',
                                "#EXTINF:1,",
                                "/0.m4s",
                                "#EXTINF:1,",
                                "/1.m4s",
                                "#EXT-X-ENDLIST",
                            ].join("\n"),
                        );
                        break;
                    case "/init.mp4":
                        response.end(protectedInitialization);
                        break;
                    case "/0.m4s":
                        response.end(firstFragment);
                        break;
                    case "/1.m4s":
                        response.end(secondFragment);
                        break;
                    default:
                        response.writeHead(404).end();
                }
            });
            const baseUrl = await listen(server);

            try {
                const output = path.join(directory, "media.mp4");
                const source = createHLSSource(`${baseUrl}/playlist.m3u8`, {
                    mode: "snapshot",
                    explicitKeys: [{ key: "11".repeat(16) }],
                });
                const downloader = createDownloader(source, {
                    output,
                    tempDir: directory,
                    threads: 3,
                    keepTemporaryFiles: true,
                });

                const download = downloader.download();
                await Promise.race([
                    secondFragmentCompleted,
                    download.then(() => {
                        throw new Error("Download finished before the blocked first fragment was released.");
                    }),
                ]);
                await waitForBuffer(path.join(directory, "media_0.mp4"), clearInitialization);
                expect(fs.existsSync(output)).toBe(false);
                releaseFirstFragment();
                await download;

                expect(fs.readFileSync(output)).toEqual(
                    Buffer.concat([clearInitialization, firstFragment, secondFragment]),
                );
                expect(downloader.getSnapshot()).toMatchObject({
                    status: "finished",
                    successfulChunkCount: 3,
                    droppedChunkCount: 0,
                    outputPaths: [output],
                });
                const trackDirectory = path.join(downloader.getSnapshot().tempPath, "main");
                expect(fs.existsSync(path.join(trackDirectory, "000000_init.mp4"))).toBe(false);
                expect(fs.existsSync(path.join(trackDirectory, "000000_init.mp4.decrypt"))).toBe(true);
                const firstCompletion = completions.findIndex((name) => name === "000001_0.m4s");
                const secondCompletion = completions.findIndex((name) => name === "000002_1.m4s");
                expect(secondCompletion).toBeGreaterThanOrEqual(0);
                expect(secondCompletion).toBeLessThan(firstCompletion);
            } finally {
                releaseFirstFragment();
                await close(server);
                runner.mockRestore();
            }
        });
    });
});

async function waitForBuffer(filePath: string, expected: Buffer): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (fs.existsSync(filePath) && fs.readFileSync(filePath).equals(expected)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for output contents at ${filePath}.`);
}
