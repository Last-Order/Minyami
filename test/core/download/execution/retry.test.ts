import * as http from "http";
import { AddressInfo } from "net";
import { describe, expect, test } from "@jest/globals";
import { createArchiveDownloader } from "@/core/archive";
import { withTempDirectory } from "../../../helpers/filesystem";
import { close, listen } from "../../../helpers/http";

describe("download retry lifecycle", () => {
    test("records a dropped item after exhausting task attempts", async () => {
        let chunkRequests = 0;
        const server = http.createServer((request, response) => {
            if (request.url === "/failed.ts") {
                chunkRequests++;
                response.statusCode = 500;
                response.end("failed");
                return;
            }
            const address = server.address() as AddressInfo;
            response.setHeader("content-type", "application/vnd.apple.mpegurl");
            response.end(
                [
                    "#EXTM3U",
                    "#EXT-X-TARGETDURATION:1",
                    "#EXT-X-MEDIA-SEQUENCE:0",
                    "#EXTINF:1,",
                    `http://127.0.0.1:${address.port}/failed.ts`,
                    "#EXT-X-ENDLIST",
                ].join("\n")
            );
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-retry-limit-", async (directory) => {
                let chunkErrors = 0;
                const downloader = createArchiveDownloader(`${baseUrl}/playlist.m3u8`, {
                    noMerge: true,
                    taskAttempts: 2,
                    tempDir: directory,
                });
                downloader.on("chunk-error", () => chunkErrors++);

                await downloader.download();

                expect(chunkRequests).toBe(2);
                expect(chunkErrors).toBe(2);
                expect(downloader.getSnapshot()).toMatchObject({
                    completedChunkCount: 1,
                    successfulChunkCount: 0,
                    droppedChunkCount: 1,
                    successfulDuration: 0,
                    totalChunkCount: 1,
                    status: "finished",
                });
            });
        } finally {
            await close(server);
        }
    });
});
