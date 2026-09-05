import * as fs from "fs";
import * as http from "http";
import { AddressInfo } from "net";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { createLiveDownloader } from "@/core/live";
import { withTempDirectory } from "../helpers/filesystem";
import { close, listen, masterVariantChunks, withMasterPlaylistServer } from "../helpers/http";

describe("createLiveDownloader", () => {
    test.each([
        ["key HTTP failure", '#EXT-X-KEY:METHOD=AES-128,URI="/key"', "Request failed with status code 404", 2],
        ["invalid duration", "#EXTINF:invalid,\n/1.ts", "Invalid duration for media segment", 0],
        ["nested master", "#EXT-X-STREAM-INF:BANDWIDTH=1000\n/other.m3u8", "another master playlist", 0],
        ["missing explicit key", '#EXT-X-KEY:METHOD=AES-128,URI="skd://asset"', "explicit decryption key", 0],
    ] as const)("fails on refresh %s without admitting unprepared media", async (_name, tag, message, keyAttempts) => {
        let playlistRequests = 0;
        let keyRequests = 0;
        let refreshedChunkRequests = 0;
        const server = http.createServer((request, response) => {
            if (request.url === "/key") {
                keyRequests++;
                response.writeHead(404).end();
                return;
            }
            if (request.url === "/0.ts" || request.url === "/1.ts") {
                if (request.url === "/1.ts") {
                    refreshedChunkRequests++;
                }
                response.end("chunk");
                return;
            }
            playlistRequests++;
            response.end(
                playlistRequests === 1
                    ? "#EXTM3U\n#EXTINF:0.01,\n/0.ts"
                    : `#EXTM3U\n${tag}\n#EXTINF:0.01,\n/1.ts\n#EXT-X-ENDLIST`,
            );
        });
        const baseUrl = await listen(server);
        try {
            await withTempDirectory("minyami-live-refresh-failure-", async (directory) => {
                const downloader = createLiveDownloader(`${baseUrl}/playlist.m3u8`, {
                    output: path.join(directory, "live"),
                    tempDir: directory,
                    sourceRequestAttempts: 2,
                });

                await expect(downloader.download()).rejects.toThrow(message);

                expect(downloader.getSnapshot()).toMatchObject({ status: "failed", totalChunkCount: 1 });
                expect(playlistRequests).toBe(2);
                expect(keyRequests).toBe(keyAttempts);
                expect(refreshedChunkRequests).toBe(0);
            });
        } finally {
            await close(server);
        }
    });

    test.each(["disconnect", 404, 503] as const)("preserves playlist request policy for %s", async (failure) => {
        let playlistRequests = 0;
        const server = http.createServer((request, response) => {
            if (request.url === "/0.ts" || request.url === "/1.ts") {
                response.end(request.url);
                return;
            }
            playlistRequests++;
            if (playlistRequests === 2) {
                if (failure === "disconnect") {
                    response.destroy();
                } else {
                    response.writeHead(failure).end();
                }
                return;
            }
            response.end(
                playlistRequests === 1
                    ? "#EXTM3U\n#EXTINF:0.01,\n/0.ts"
                    : "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:0.01,\n/1.ts\n#EXT-X-ENDLIST",
            );
        });
        const baseUrl = await listen(server);
        try {
            await withTempDirectory("minyami-live-refresh-http-", async (directory) => {
                const downloader = createLiveDownloader(`${baseUrl}/playlist.m3u8`, {
                    output: path.join(directory, "live"),
                    tempDir: directory,
                    sourceRequestAttempts: 1,
                });

                await downloader.download();

                const recovered = failure === "disconnect";
                expect(playlistRequests).toBe(recovered ? 3 : 2);
                expect(downloader.getSnapshot()).toMatchObject({
                    status: "finished",
                    completedChunkCount: recovered ? 2 : 1,
                    droppedChunkCount: 0,
                });
                expect(fs.readFileSync(downloader.getSnapshot().outputPaths[0], "utf8")).toBe(
                    recovered ? "/0.ts/1.ts" : "/0.ts",
                );
            });
        } finally {
            await close(server);
        }
    });

    test.each(["stop", "abort"] as const)("honors %s during refreshed key acquisition", async (command) => {
        let playlistRequests = 0;
        let keyRequests = 0;
        let cancel: () => void;
        const server = http.createServer((request, response) => {
            if (request.url === "/key") {
                keyRequests++;
                cancel();
                response.writeHead(404).end();
                return;
            }
            if (request.url === "/0.ts") {
                response.end("chunk");
                return;
            }
            playlistRequests++;
            response.end(
                playlistRequests === 1
                    ? "#EXTM3U\n#EXTINF:0.01,\n/0.ts"
                    : '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n#EXT-X-KEY:METHOD=AES-128,URI="/key"\n#EXTINF:0.01,\n/1.ts',
            );
        });
        const baseUrl = await listen(server);
        try {
            await withTempDirectory("minyami-live-refresh-cancel-", async (directory) => {
                const downloader = createLiveDownloader(`${baseUrl}/playlist.m3u8`, {
                    output: path.join(directory, "live"),
                    tempDir: directory,
                    sourceRequestAttempts: 2,
                });
                cancel = () => downloader[command]();

                await downloader.download();

                expect(downloader.getSnapshot()).toMatchObject({
                    status: command === "stop" ? "finished" : "aborted",
                    totalChunkCount: 1,
                });
                expect(keyRequests).toBe(1);
                expect(playlistRequests).toBe(2);
            });
        } finally {
            await close(server);
        }
    });

    test("discovers new segments across playlist refreshes and downloads each once", async () => {
        let playlistRequests = 0;
        const chunkRequests = new Map<string, number>();
        const chunks = {
            "/0.ts": Buffer.from("first-live-chunk"),
            "/1.ts": Buffer.from("second-live-chunk"),
        } as const;
        const server = http.createServer((request, response) => {
            const chunk = chunks[request.url as keyof typeof chunks];
            if (chunk) {
                chunkRequests.set(request.url!, (chunkRequests.get(request.url!) ?? 0) + 1);
                response.end(chunk);
                return;
            }
            playlistRequests++;
            const address = server.address() as AddressInfo;
            const lines = [
                "#EXTM3U",
                "#EXT-X-TARGETDURATION:1",
                "#EXT-X-MEDIA-SEQUENCE:0",
                "#EXTINF:0.01,",
                `http://127.0.0.1:${address.port}/0.ts`,
            ];
            if (playlistRequests > 1) {
                lines.push("#EXTINF:0.01,", `http://127.0.0.1:${address.port}/1.ts`, "#EXT-X-ENDLIST");
            }
            response.setHeader("content-type", "application/vnd.apple.mpegurl");
            response.end(lines.join("\n"));
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-live-incremental-", async (directory) => {
                const output = path.join(directory, "live.ts");
                const downloader = createLiveDownloader(`${baseUrl}/playlist.m3u8`, {
                    output,
                    tempDir: directory,
                    threads: 2,
                });

                await downloader.download();

                expect(playlistRequests).toBe(2);
                expect(chunkRequests).toEqual(
                    new Map([
                        ["/0.ts", 1],
                        ["/1.ts", 1],
                    ]),
                );
                expect(downloader.getSnapshot()).toMatchObject({
                    totalChunkCount: 2,
                    completedChunkCount: 2,
                    isEnd: true,
                });
                expect(fs.readFileSync(output)).toEqual(Buffer.concat(Object.values(chunks)));
            });
        } finally {
            await close(server);
        }
    });

    test("stops discovery gracefully and merges work already discovered", async () => {
        let playlistRequests = 0;
        const chunk = Buffer.from("stopped-live-chunk");
        const server = http.createServer((request, response) => {
            if (request.url === "/0.ts") {
                response.end(chunk);
                return;
            }
            playlistRequests++;
            const address = server.address() as AddressInfo;
            response.setHeader("content-type", "application/vnd.apple.mpegurl");
            response.end(
                [
                    "#EXTM3U",
                    "#EXT-X-TARGETDURATION:10",
                    "#EXT-X-MEDIA-SEQUENCE:0",
                    "#EXTINF:10,",
                    `http://127.0.0.1:${address.port}/0.ts`,
                ].join("\n"),
            );
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-live-stop-", async (directory) => {
                const output = path.join(directory, "live.ts");
                const downloader = createLiveDownloader(`${baseUrl}/playlist.m3u8`, {
                    output,
                    tempDir: directory,
                });
                downloader.once("chunk-downloaded", () => downloader.stop());

                await downloader.download();

                expect(playlistRequests).toBe(1);
                expect(downloader.getSnapshot()).toMatchObject({
                    status: "finished",
                    completedChunkCount: 1,
                    isEnd: true,
                });
                expect(fs.readFileSync(output)).toEqual(chunk);
            });
        } finally {
            await close(server);
        }
    });

    test("passes a master playlist selector through the live wrapper only once", async () => {
        await withMasterPlaylistServer(async ({ playlistUrl, highPlaylistUrl, requests }) => {
            await withTempDirectory("minyami-live-variant-", async (directory) => {
                const output = path.join(directory, "selected.ts");
                let selectorCalls = 0;
                const downloader = createLiveDownloader(playlistUrl, {
                    output,
                    tempDir: directory,
                    streamSelector: (catalog) => {
                        selectorCalls++;
                        return catalog.options[1].tracks;
                    },
                });

                await downloader.download();

                expect(selectorCalls).toBe(1);
                expect(downloader.getSnapshot()).toMatchObject({
                    sourcePath: playlistUrl,
                    tracks: [{ id: "video-2", sourcePath: highPlaylistUrl }],
                });
                expect(requests.get("/master.m3u8")).toBe(1);
                expect(requests.get("/high.m3u8")).toBe(1);
                expect(fs.readFileSync(output)).toEqual(masterVariantChunks.high);
            });
        });
    });
});
