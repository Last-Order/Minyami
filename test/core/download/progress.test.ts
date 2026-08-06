import { describe, expect, jest, test } from "@jest/globals";
import { DownloadTask } from "../../../src/core/downloader";
import { ProgressTracker } from "../../../src/core/download/progress";

describe("ProgressTracker", () => {
    test("tracks completed work and media duration independently", () => {
        const progress = new ProgressTracker();
        progress.start(1_000);
        progress.recordSuccessful(createTask(0, { url: "https://example.com/init.mp4", kind: "init" }));
        progress.recordSuccessful(
            createTask(1, { url: "https://example.com/segment.m4s", kind: "media", duration: 2 })
        );
        progress.recordDropped();
        jest.spyOn(Date, "now").mockReturnValue(5_000);

        expect(progress.snapshot).toEqual({
            startedAt: 1_000,
            completedChunkCount: 3,
            successfulChunkCount: 2,
            droppedChunkCount: 1,
            successfulDuration: 2,
        });
        expect(progress.successfulChunksPerSecond()).toBe("0.50");
        expect(progress.successfulDurationRatio()).toBe("0.50");
        expect(progress.completionEta(6)).toBe("4s");
    });
});

function createTask(id: number, item: DownloadTask["item"]): DownloadTask {
    return {
        id,
        item,
        filename: `${id}.ts`,
        retryCount: 0,
    };
}
