import * as fs from "fs";
import * as http from "http";
import { AddressInfo } from "net";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { createLiveDownloader } from "@/core/live";
import { withTempDirectory } from "../helpers/filesystem";
import { close, listen, masterVariantChunks, withMasterPlaylistServer } from "../helpers/http";

describe("createLiveDownloader", () => {
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
