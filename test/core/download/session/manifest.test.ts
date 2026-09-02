import { describe, expect, jest, test } from "@jest/globals";
import { DownloadManifest } from "@/core/download/session/manifest";

describe("DownloadManifest", () => {
    test("owns discovery order, totals, and terminal progress for every track", () => {
        const manifest = new DownloadManifest();
        manifest.start(1_000);
        manifest.registerTracks([
            {
                id: "main",
                mediaTrack: { id: "logical-main", type: "video" },
                sourcePath: "custom://main",
            },
        ]);
        const tasks = manifest.discover(
            {
                trackId: "main",
                items: [
                    { url: "https://example.com/init.mp4", kind: "init" },
                    { url: "https://example.com/segment.m4s", kind: "media", duration: 2 },
                    { url: "https://example.com/dropped.ts", kind: "media", duration: 3 },
                ],
                totalItemCount: 3,
            },
            () => undefined,
        );
        manifest.recordSuccessful(tasks[0]);
        manifest.recordSuccessful(tasks[1]);
        manifest.recordDropped(tasks[2]);
        jest.spyOn(Date, "now").mockReturnValue(5_000);

        expect(tasks.map(({ id, trackIndex, filename }) => ({ id, trackIndex, filename }))).toEqual([
            { id: 0, trackIndex: 0, filename: "000000_init.mp4" },
            { id: 1, trackIndex: 1, filename: "000001_segment.m4s" },
            { id: 2, trackIndex: 2, filename: "000002_dropped.ts" },
        ]);
        expect(manifest.snapshot).toMatchObject({
            startedAt: 1_000,
            totalChunkCount: 3,
            completedChunkCount: 3,
            successfulChunkCount: 2,
            droppedChunkCount: 1,
            successfulDuration: 2,
            tracks: [
                {
                    metadata: { id: "main" },
                    totalChunkCount: 3,
                    completedChunkCount: 3,
                    successfulChunkCount: 2,
                    droppedChunkCount: 1,
                    successfulDuration: 2,
                },
            ],
        });
        expect(manifest.successfulChunksPerSecond()).toBe("0.50");
        expect(manifest.successfulDurationRatio()).toBe("0.50");
        expect(manifest.completionEta()).toBe("0s");
    });
});
