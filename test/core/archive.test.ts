import * as fs from "fs";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { createArchiveDownloader } from "../../src/core/archive";
import { ChunkDownloadedInfo } from "../../src/core/download/controller";
import { withTempDirectory } from "../helpers/filesystem";
import { withMediaServer } from "../helpers/http";

describe("createArchiveDownloader", () => {
    test("downloads a finite HLS playlist and reports completed work", async () => {
        await withMediaServer(async (playlistUrl, expectedOutput) => {
            await withTempDirectory("minyami-archive-", async (directory) => {
                const output = path.join(directory, "archive.ts");
                const downloader = createArchiveDownloader(playlistUrl, {
                    output,
                    tempDir: directory,
                    threads: 2,
                });
                let latestChunkInfo: ChunkDownloadedInfo | undefined;
                downloader.on("chunk-downloaded", (chunkInfo: ChunkDownloadedInfo) => {
                    latestChunkInfo = chunkInfo;
                });

                await downloader.download();

                expect(downloader.getSnapshot()).toMatchObject({
                    status: "finished",
                    totalChunkCount: 2,
                    completedChunkCount: 2,
                    successfulChunkCount: 2,
                    droppedChunkCount: 0,
                    successfulDuration: 2,
                    pendingTaskCount: 0,
                });
                expect(latestChunkInfo).toMatchObject({
                    completedChunkCount: 2,
                    successfulChunkCount: 2,
                    droppedChunkCount: 0,
                    totalChunkCount: 2,
                });
                expect(fs.readFileSync(output)).toEqual(expectedOutput);
                expect(fs.readdirSync(directory)).toEqual(["archive.ts"]);
            });
        });
    });

    test("selects media segments that overlap the requested slice", async () => {
        await withMediaServer(async (playlistUrl) => {
            await withTempDirectory("minyami-archive-slice-", async (directory) => {
                const output = path.join(directory, "slice.ts");
                const downloader = createArchiveDownloader(playlistUrl, {
                    output,
                    tempDir: directory,
                    slice: "00:00:01-00:00:02",
                });

                await downloader.download();

                expect(downloader.getSnapshot()).toMatchObject({
                    totalChunkCount: 1,
                    completedChunkCount: 1,
                });
                expect(fs.readFileSync(output)).toEqual(Buffer.from("second-chunk"));
            });
        });
    });
});
