import { describe, expect, jest, test } from "@jest/globals";
import { DownloadManifest } from "../../../../src/core/download/session/manifest";

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
            () => undefined
        );
        manifest.recordSuccessful(tasks[0]);
        manifest.recordSuccessful(tasks[1]);
        manifest.recordDropped(tasks[2]);
        jest.spyOn(Date, "now").mockReturnValue(5_000);

        expect(tasks.map((task) => ({ id: task.id, trackIndex: task.trackIndex }))).toEqual([
            { id: 0, trackIndex: 0 },
            { id: 1, trackIndex: 1 },
            { id: 2, trackIndex: 2 },
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
