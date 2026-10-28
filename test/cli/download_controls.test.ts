import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { installCliDownloadControls } from "@/cli/download_controls";
import { installCliDownloadProgress } from "@/cli/download_progress";
import { DownloadController } from "@/core/download/downloader";
import logger from "@/utils/log";

jest.mock("@/cli/download_progress", () => ({ installCliDownloadProgress: jest.fn(() => () => undefined) }));

afterEach(() => {
    jest.useRealTimers();
});

describe("CLI download controls", () => {
    test("gracefully stops on the first SIGINT and aborts on the second", () => {
        const downloader = createController();
        const previousListeners = new Set(process.listeners("SIGINT"));
        const dispose = installCliDownloadControls(downloader, false, true);
        const listener = process.listeners("SIGINT").find((candidate) => !previousListeners.has(candidate));

        try {
            expect(listener).toBeDefined();
            listener?.("SIGINT");
            expect(downloader.stop).toHaveBeenCalledTimes(1);
            expect(downloader.abort).not.toHaveBeenCalled();

            listener?.("SIGINT");
            expect(downloader.abort).toHaveBeenCalledTimes(1);
        } finally {
            dispose();
        }

        expect(process.listeners("SIGINT")).not.toContain(listener);
    });

    test("reports snapshots while verbose mode is active and clears the timer", () => {
        jest.useFakeTimers();
        const downloader = createController();
        const debug = jest.spyOn(logger, "debug").mockImplementation(() => undefined);
        const dispose = installCliDownloadControls(downloader, true, false);

        jest.advanceTimersByTime(3000);
        expect(downloader.getSnapshot).toHaveBeenCalledTimes(1);
        expect(debug).toHaveBeenCalledWith(
            "Waiting tasks: 2, completed chunks: 3, successful chunks: 2, dropped chunks: 1, total discovered chunks: 5",
        );

        dispose();
        jest.advanceTimersByTime(3000);
        expect(downloader.getSnapshot).toHaveBeenCalledTimes(1);
    });

    test("releases process controls even when terminal cleanup throws", () => {
        jest.useFakeTimers();
        const downloader = createController();
        const previousListeners = process.listeners("SIGINT");
        const error = new Error("terminal cleanup failed");
        jest.mocked(installCliDownloadProgress).mockReturnValueOnce(() => {
            throw error;
        });
        const dispose = installCliDownloadControls(downloader, true, true);

        expect(() => dispose()).toThrow(error);
        expect(process.listeners("SIGINT")).toEqual(previousListeners);
        expect(jest.getTimerCount()).toBe(0);
        jest.advanceTimersByTime(3000);
        expect(downloader.getSnapshot).not.toHaveBeenCalled();
    });
});

function createController(): jest.Mocked<DownloadController> {
    return {
        download: jest.fn<DownloadController["download"]>(),
        stop: jest.fn<DownloadController["stop"]>(),
        abort: jest.fn<DownloadController["abort"]>(),
        getSnapshot: jest.fn<DownloadController["getSnapshot"]>().mockReturnValue({
            status: "downloading",
            sourcePath: "source.m3u8",
            tempPath: ".",
            outputBasePath: "output",
            outputPaths: [],
            artifacts: [],
            tracks: [],
            startedAt: 0,
            completedChunkCount: 3,
            successfulChunkCount: 2,
            droppedChunkCount: 1,
            successfulDuration: 0,
            runningTaskCount: 1,
            pendingTaskCount: 2,
            totalChunkCount: 5,
            isEnd: false,
        }),
        on: jest.fn<DownloadController["on"]>(),
        once: jest.fn<DownloadController["once"]>(),
        off: jest.fn<DownloadController["off"]>(),
    };
}
