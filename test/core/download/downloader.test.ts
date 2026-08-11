import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { createDownloader } from "../../../src/core/download/downloader";
import { MPEG_TS_CONTAINER } from "../../../src/core/media_container";
import { DownloadSource } from "../../../src/core/source/types";
import { close, listen, withMediaServer } from "../../helpers/http";
import { withTempDirectory } from "../../helpers/filesystem";

describe("createDownloader", () => {
    test("downloads and merges protocol-neutral items from a custom source", async () => {
        await withMediaServer(async (playlistUrl, expectedOutput) => {
            await withTempDirectory("minyami-custom-source-", async (directory) => {
                const output = path.join(directory, "custom.ts");
                const source: DownloadSource = {
                    sourcePath: "custom://media",
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
                                { url: new URL("/0.ts", playlistUrl).href, kind: "init" },
                                { url: new URL("/1.ts", playlistUrl).href, kind: "media", duration: 1 },
                            ],
                            totalItemCount: 2,
                        };
                    },
                };
                const downloader = createDownloader(source, { output, tempDir: directory, threads: 2 });
                let finished = false;
                const finalizingStatuses: string[] = [];
                downloader.once("finished", () => {
                    finished = true;
                });
                downloader.once("downloaded", () => {
                    finalizingStatuses.push(downloader.getSnapshot().status);
                    downloader.stop();
                    finalizingStatuses.push(downloader.getSnapshot().status);
                });

                await downloader.download();

                expect(finished).toBe(true);
                expect(finalizingStatuses).toEqual(["merging", "merging"]);
                expect(downloader.getSnapshot()).toMatchObject({
                    status: "finished",
                    sourcePath: "custom://media",
                    totalChunkCount: 2,
                    completedChunkCount: 2,
                    successfulChunkCount: 2,
                    droppedChunkCount: 0,
                    successfulDuration: 1,
                    pendingTaskCount: 0,
                    isEnd: true,
                });
                expect(fs.readFileSync(output)).toEqual(expectedOutput);
            });
        });
    });

    test("uses keys prepared by a custom source to decrypt its items", async () => {
        const key = Buffer.from("0123456789abcdef");
        const iv = Buffer.alloc(16);
        iv[15] = 1;
        const expected = Buffer.from("custom encrypted payload");
        const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
        const encrypted = Buffer.concat([cipher.update(expected), cipher.final()]);
        let itemRequests = 0;
        const server = http.createServer((_request, response) => {
            itemRequests++;
            response.end(encrypted);
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-custom-encrypted-source-", async (directory) => {
                const output = path.join(directory, "custom-encrypted.ts");
                const keyId = "custom:media-key";
                const source: DownloadSource = {
                    sourcePath: "custom://encrypted-media",
                    continuous: false,
                    async prepare(context) {
                        context.keys.set(keyId, key.toString("hex"));
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
                                    url: `${baseUrl}/encrypted.ts`,
                                    kind: "media",
                                    duration: 1,
                                    encryption: {
                                        scheme: "aes-128-cbc",
                                        keyId,
                                        iv: iv.toString("hex"),
                                    },
                                },
                            ],
                            totalItemCount: 1,
                        };
                    },
                };
                const downloader = createDownloader(source, { output, tempDir: directory });

                await downloader.download();

                expect(itemRequests).toBe(1);
                expect(downloader.getSnapshot()).toMatchObject({
                    completedChunkCount: 1,
                    successfulChunkCount: 1,
                    successfulDuration: 1,
                });
                expect(fs.readFileSync(output)).toEqual(expected);
            });
        } finally {
            await close(server);
        }
    });

    test("splits merged output when a discovered item is dropped", async () => {
        const server = http.createServer((request, response) => {
            if (request.url === "/failed.ts") {
                response.statusCode = 500;
                response.end("failed");
                return;
            }
            response.end(request.url === "/first.ts" ? "first" : "second");
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-custom-source-gap-", async (directory) => {
                const output = path.join(directory, "gapped.ts");
                const source: DownloadSource = {
                    sourcePath: "custom://gapped-media",
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
                                { url: `${baseUrl}/first.ts`, kind: "media", duration: 1 },
                                { url: `${baseUrl}/failed.ts`, kind: "media", duration: 1 },
                                { url: `${baseUrl}/second.ts`, kind: "media", duration: 1 },
                            ],
                            totalItemCount: 3,
                        };
                    },
                };
                const downloader = createDownloader(source, {
                    output,
                    tempDir: directory,
                    taskAttempts: 1,
                    threads: 3,
                });

                await downloader.download();

                const firstOutput = path.join(directory, "gapped_0.ts");
                const secondOutput = path.join(directory, "gapped_1.ts");
                expect(downloader.getSnapshot()).toMatchObject({
                    completedChunkCount: 3,
                    successfulChunkCount: 2,
                    droppedChunkCount: 1,
                });
                expect(fs.readFileSync(firstOutput, "utf8")).toBe("first");
                expect(fs.readFileSync(secondOutput, "utf8")).toBe("second");
            });
        } finally {
            await close(server);
        }
    });

    test("publishes the failed lifecycle when source preparation fails", async () => {
        await withTempDirectory("minyami-failure-", async (directory) => {
            const source: DownloadSource = {
                sourcePath: "custom://failure",
                continuous: false,
                async prepare() {
                    throw new Error("source preparation failed");
                },
                async *discover() {
                    yield { trackId: "main", items: [] };
                },
            };
            const downloader = createDownloader(source, { tempDir: directory });
            let criticalError: Error | undefined;
            downloader.once("critical-error", (error: Error) => {
                criticalError = error;
            });

            await expect(downloader.download()).rejects.toThrow("source preparation failed");

            expect(criticalError).toBeInstanceOf(Error);
            expect(downloader.getSnapshot().status).toBe("failed");
        });
    });

    test("finishes preparation cancellation without publishing download or error events", async () => {
        await withTempDirectory("minyami-cancelled-source-", async (directory) => {
            const output = path.join(directory, "cancelled.ts");
            const source: DownloadSource = {
                sourcePath: "custom://cancelled",
                continuous: false,
                async prepare() {
                    return { cancelled: true };
                },
                async *discover() {
                    throw new Error("Cancelled sources must not start discovery.");
                },
            };
            const downloader = createDownloader(source, { output, tempDir: directory });
            const events: string[] = [];
            for (const event of ["parsed", "downloaded", "critical-error", "finished"] as const) {
                downloader.on(event, () => events.push(event));
            }

            await expect(downloader.download()).resolves.toBeUndefined();

            expect(events).toEqual(["finished"]);
            expect(downloader.getSnapshot()).toMatchObject({
                status: "finished",
                isEnd: true,
                totalChunkCount: 0,
                completedChunkCount: 0,
            });
            expect(fs.existsSync(output)).toBe(false);
            expect(fs.readdirSync(directory)).toEqual([]);
        });
    });

    test("treats a graceful stop during preparation as cancellation", async () => {
        await withTempDirectory("minyami-stop-preparing-", async (directory) => {
            let preparationStarted!: () => void;
            const started = new Promise<void>((resolve) => {
                preparationStarted = resolve;
            });
            const source: DownloadSource = {
                sourcePath: "custom://slow-prepare",
                continuous: true,
                async prepare(_context, signal) {
                    preparationStarted();
                    return new Promise((_resolve, reject) => {
                        signal.addEventListener("abort", () => reject(new Error("preparation aborted")), {
                            once: true,
                        });
                    });
                },
                async *discover() {
                    throw new Error("Stopped preparation must not start discovery.");
                },
            };
            const downloader = createDownloader(source, { tempDir: directory });
            const events: string[] = [];
            downloader.on("critical-error", () => events.push("critical-error"));
            downloader.on("finished", () => events.push("finished"));

            const completion = downloader.download();
            await started;
            downloader.stop();
            expect(downloader.getSnapshot().status).toBe("stopping");

            await expect(completion).resolves.toBeUndefined();
            expect(events).toEqual(["finished"]);
            expect(downloader.getSnapshot()).toMatchObject({ status: "finished", isEnd: true });
            expect(fs.readdirSync(directory)).toEqual([]);
        });
    });

    test("isolates observer failures from successful task commits", async () => {
        await withMediaServer(async (playlistUrl, expectedOutput) => {
            await withTempDirectory("minyami-observer-failure-", async (directory) => {
                const output = path.join(directory, "observer.ts");
                const source: DownloadSource = {
                    sourcePath: "custom://observer",
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
                                { url: new URL("/0.ts", playlistUrl).href, kind: "init" },
                                { url: new URL("/1.ts", playlistUrl).href, kind: "media", duration: 1 },
                            ],
                            totalItemCount: 2,
                        };
                    },
                };
                const downloader = createDownloader(source, { output, tempDir: directory, taskAttempts: 2 });
                let laterObserverCalls = 0;
                downloader.on("chunk-downloaded", () => {
                    throw new Error("observer failed");
                });
                downloader.on("chunk-downloaded", () => laterObserverCalls++);

                await expect(downloader.download()).resolves.toBeUndefined();

                expect(laterObserverCalls).toBe(2);
                expect(downloader.getSnapshot()).toMatchObject({
                    status: "finished",
                    completedChunkCount: 2,
                    successfulChunkCount: 2,
                    droppedChunkCount: 0,
                });
                expect(fs.readFileSync(output)).toEqual(expectedOutput);
            });
        });
    });

    test("hard abort cancels active task I/O before publishing a stable terminal event", async () => {
        let requestStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            requestStarted = resolve;
        });
        let responseTimer: NodeJS.Timeout | undefined;
        const server = http.createServer((_request, response) => {
            requestStarted();
            responseTimer = setTimeout(() => response.end("late payload"), 1000);
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-hard-abort-", async (directory) => {
                const source: DownloadSource = {
                    sourcePath: "custom://hard-abort",
                    continuous: true,
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
                    async *discover(_context, signal) {
                        yield {
                            trackId: "main",
                            items: [{ url: `${baseUrl}/slow.ts`, kind: "media", duration: 1 }],
                        };
                        await new Promise<void>((resolve) => {
                            signal.addEventListener("abort", () => resolve(), { once: true });
                        });
                    },
                };
                const downloader = createDownloader(source, { tempDir: directory });
                const events: string[] = [];
                downloader.on("chunk-downloaded", () => events.push("chunk-downloaded"));
                downloader.on("finished", () => events.push("finished"));

                const completion = downloader.download();
                await started;
                downloader.abort();
                await expect(completion).resolves.toBeUndefined();

                expect(events).toEqual(["finished"]);
                expect(downloader.getSnapshot()).toMatchObject({
                    status: "aborted",
                    completedChunkCount: 0,
                    runningTaskCount: 0,
                    pendingTaskCount: 0,
                    isEnd: true,
                });
            });
        } finally {
            if (responseTimer) {
                clearTimeout(responseTimer);
            }
            await close(server);
        }
    });
});
