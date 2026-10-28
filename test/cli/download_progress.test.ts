import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { Instance, render } from "ink";
import { installCliDownloadProgress } from "@/cli/download_progress";
import { renderDownloadProgress } from "@/cli/download_progress_view";
import { SourceDownloadSnapshot } from "@/core/download/controller";
import { DownloadController } from "@/core/download/downloader";
import logger from "@/utils/log";

// Ink's ESM renderer loads Yoga through top-level await; exercise the real renderer in the ESM CLI smoke checks.
jest.mock("ink", () => ({ Text: "ink-text", render: jest.fn() }));

const instance = {
    rerender: jest.fn<Instance["rerender"]>(),
    unmount: jest.fn<Instance["unmount"]>(),
    clear: jest.fn<Instance["clear"]>(),
    cleanup: jest.fn<Instance["cleanup"]>(),
    waitUntilExit: jest.fn<Instance["waitUntilExit"]>(),
    waitUntilRenderFlush: jest.fn<Instance["waitUntilRenderFlush"]>(),
};
const originalTerm = process.env.TERM;
const terminalProperties = [
    [process.stdout, "isTTY"],
    [process.stderr, "isTTY"],
    [process.stdout, "columns"],
    [process.stdout, "rows"],
] as const;
const descriptors = terminalProperties.map(([stream, property]) => Object.getOwnPropertyDescriptor(stream, property));
let dispose: (() => void) | undefined;

beforeEach(() => {
    jest.useFakeTimers({ now: 11_000 });
    jest.mocked(render).mockReturnValue(instance);
    delete process.env.TERM;
    Object.defineProperties(process.stdout, {
        isTTY: { configurable: true, value: true },
        columns: { configurable: true, value: 100 },
        rows: { configurable: true, value: 24 },
    });
    Object.defineProperty(process.stderr, "isTTY", { configurable: true, value: true });
});

afterEach(() => {
    dispose?.();
    dispose = undefined;
    for (const [index, [stream, property]] of terminalProperties.entries()) {
        const descriptor = descriptors[index];
        if (descriptor) {
            Object.defineProperty(stream, property, descriptor);
        } else {
            Reflect.deleteProperty(stream, property);
        }
    }
    if (originalTerm === undefined) {
        delete process.env.TERM;
    } else {
        process.env.TERM = originalTerm;
    }
    jest.useRealTimers();
});

describe("CLI progress display", () => {
    test("starts Ink after selection, coalesces completions, and delegates ordinary logs to its console integration", () => {
        const { controller, events } = createController();
        const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
        dispose = installCliDownloadProgress(controller, false);

        jest.advanceTimersByTime(500);
        expect(render).not.toHaveBeenCalled();
        events.emit("parsed");
        expect(render).toHaveBeenCalledWith(
            expect.objectContaining({
                props: expect.objectContaining({ children: expect.stringContaining("Minyami") }),
            }),
            expect.objectContaining({
                stdout: process.stdout,
                stderr: process.stderr,
                incrementalRendering: true,
                maxFps: 5,
                patchConsole: true,
                exitOnCtrlC: false,
            }),
        );
        logger.progress("one chunk completed");
        logger.progress("another chunk completed");
        expect(instance.rerender).not.toHaveBeenCalled();
        expect(info).not.toHaveBeenCalled();

        jest.mocked(controller.getSnapshot).mockReturnValue(createSnapshot({ currentBytesPerSecond: 0 }));
        jest.advanceTimersByTime(200);
        expect(instance.rerender).toHaveBeenLastCalledWith(
            expect.objectContaining({
                props: expect.objectContaining({ children: expect.stringContaining("Speed: 0.00 Mbps") }),
            }),
        );

        logger.warning("retrying");
        expect(warning).toHaveBeenCalledWith(expect.stringContaining("retrying"));
    });

    test("keeps stable frames mounted without scheduling redundant Ink renders", () => {
        const { controller, events } = createController();
        dispose = installCliDownloadProgress(controller, false);
        events.emit("parsed");
        jest.advanceTimersByTime(400);
        expect(render).toHaveBeenCalledTimes(1);
        expect(instance.rerender).not.toHaveBeenCalled();
        jest.advanceTimersByTime(200);
        expect(instance.rerender).toHaveBeenCalledTimes(1);
        expect(instance.rerender).toHaveBeenCalledWith(
            expect.objectContaining({
                props: expect.objectContaining({ children: expect.stringContaining("Elapsed: 00:00:11") }),
            }),
        );
    });

    test.each(["finished", "aborted", "failed"] as const)(
        "removes the dashboard and releases resources after the session is %s",
        (status) => {
            const { controller, events } = createController();
            const previousResizeListeners = process.stdout.listenerCount("resize");
            const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
            dispose = installCliDownloadProgress(controller, true);
            events.emit("parsed");
            jest.mocked(controller.getSnapshot).mockReturnValue(createSnapshot({ status }));
            events.emit(status === "failed" ? "critical-error" : "finished");

            expect(instance.rerender).toHaveBeenLastCalledWith(null);
            expect(instance.unmount).toHaveBeenCalledTimes(1);
            expect(instance.rerender.mock.invocationCallOrder.at(-1)).toBeLessThan(
                instance.unmount.mock.invocationCallOrder[0],
            );
            expect(events.eventNames()).toEqual([]);
            expect(process.stdout.listenerCount("resize")).toBe(previousResizeListeners);
            const frameCount = instance.rerender.mock.calls.length;
            jest.advanceTimersByTime(1000);
            dispose();
            expect(instance.rerender).toHaveBeenCalledTimes(frameCount);
            expect(instance.unmount).toHaveBeenCalledTimes(1);
            logger.progress("plain progress restored");
            expect(info).toHaveBeenCalledWith(expect.stringContaining("plain progress restored"));
        },
    );

    test.each(["stdout", "stderr", "dumb"])("keeps line logs for non-interactive %s", (stream) => {
        if (stream === "dumb") {
            process.env.TERM = "dumb";
        } else {
            Object.defineProperty(process[stream as "stdout" | "stderr"], "isTTY", {
                configurable: true,
                value: false,
            });
        }
        const { controller, events } = createController();
        const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
        dispose = installCliDownloadProgress(controller, false);
        events.emit("parsed");
        jest.advanceTimersByTime(1000);
        expect(render).not.toHaveBeenCalled();
        logger.progress("plain progress");
        expect(info).toHaveBeenCalledWith(expect.stringContaining("plain progress"));
    });

    test("restores progress logs and releases subscriptions when Ink teardown throws", () => {
        const { controller, events } = createController();
        const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
        const error = new Error("Ink teardown failed");
        dispose = installCliDownloadProgress(controller, false);
        events.emit("parsed");
        instance.unmount.mockImplementationOnce(() => {
            throw error;
        });

        expect(() => dispose?.()).toThrow(error);
        expect(events.eventNames()).toEqual([]);
        expect(jest.getTimerCount()).toBe(0);
        logger.progress("progress restored after teardown failure");
        expect(info).toHaveBeenCalledWith(expect.stringContaining("progress restored after teardown failure"));
    });

    test("redraws to fit a resized terminal and cleans up when disposed during a download", () => {
        const { controller, events } = createController();
        Object.defineProperty(process.stdout, "columns", { configurable: true, value: 120 });
        dispose = installCliDownloadProgress(controller, false);
        events.emit("parsed");
        const initial = jest.mocked(render).mock.calls[0][0] as { props: { children: string } };
        expect(initial.props.children.split("\n")).toHaveLength(2);
        expect(initial.props.children.split("\n")[0]).toHaveLength(119);
        Object.defineProperty(process.stdout, "columns", { configurable: true, value: 38 });
        Object.defineProperty(process.stdout, "rows", { configurable: true, value: 10 });
        process.stdout.emit("resize");
        const element = instance.rerender.mock.calls.at(-1)?.[0] as { props: { children: string } };
        const frame = element.props.children.split("\n");
        expect(frame.length).toBeGreaterThan(2);
        expect(frame.length).toBeLessThan(10);
        expect(frame.every((line) => line.length < 38)).toBe(true);
        expect(frame.find((line) => line.includes("Total ["))).toHaveLength(37);
        Object.defineProperty(process.stdout, "columns", { configurable: true, value: 160 });
        process.stdout.emit("resize");
        const expanded = instance.rerender.mock.calls.at(-1)?.[0] as { props: { children: string } };
        expect(expanded.props.children.split("\n")).toHaveLength(2);
        expect(expanded.props.children.split("\n")[0]).toHaveLength(159);
        dispose();
        expect(events.eventNames()).toEqual([]);
        expect(jest.getTimerCount()).toBe(0);
        expect(instance.unmount).toHaveBeenCalledTimes(1);
    });
});

describe("progress view", () => {
    test("shows aggregate progress, Mbps, elapsed time, and an archive ETA", () => {
        const view = renderDownloadProgress(createSnapshot(), false, 120, 24, 11_000);
        expect(view).toEqual([
            expect.stringMatching(/^Minyami \| Downloading \| Total .*50\.0% 5\/10 chunks$/),
            "Speed: 8.00 Mbps | Elapsed: 00:00:10 | ETA: 00:00:10 | Active: 2 | Queued: 3 | Successful: 4 | Dropped: 1",
        ]);
    });

    test("uses discovered counts for live streams without a percentage or a completion ETA", () => {
        const view = renderDownloadProgress(createSnapshot(), true, 120, 24, 11_000);
        expect(view).toEqual([
            "Minyami | LIVE | Downloading | Chunks: 5 / 10 discovered",
            "Speed: 8.00 Mbps | Elapsed: 00:00:10 | ETA: -- | Active: 2 | Queued: 3 | Successful: 4 | Dropped: 1",
            "Ctrl+C: finish known tasks | again: abort",
        ]);
    });

    test("handles no chunks, merging, and short terminals", () => {
        const empty = createSnapshot({ completedChunkCount: 0, totalChunkCount: 0, tracks: [] });
        expect(renderDownloadProgress(empty, false, 100, 24).join("\n")).toContain("0.0% 0/0");
        expect(renderDownloadProgress(empty, false, 100, 24).join("\n")).toContain("ETA: --");
        const merging = createSnapshot({ status: "merging" });
        expect(renderDownloadProgress(merging, false, 100, 24).join("\n")).toContain("Merging / muxing");
        expect(renderDownloadProgress(merging, false, 100, 24).join("\n")).toContain("ETA: --");
        const short = renderDownloadProgress(createSnapshot(), false, 80, 3, 11_000);
        expect(short).toEqual([
            expect.stringMatching(/^Minyami \| Downloading \| Total .*50\.0% 5\/10 chunks$/),
            "Speed: 8.00 Mbps | Elapsed: 00:00:10 | ETA: 00:00:10 | Active: 2 | Queued: 3",
        ]);
    });

    test.each([40, 80, 120, 160])("packs all progress fields within a %i-column terminal", (columns) => {
        const snapshot = createSnapshot({
            completedChunkCount: 113,
            successfulChunkCount: 113,
            droppedChunkCount: 0,
            totalChunkCount: 2918,
            runningTaskCount: 16,
            pendingTaskCount: 2789,
            currentBytesPerSecond: 32_748_750,
        });
        const lines = renderDownloadProgress(snapshot, false, columns, 24, 15_000);
        const view = lines.join("\n");
        expect(lines.every((line) => line.length < columns)).toBe(true);
        expect(lines.find((line) => line.includes("Total ["))).toHaveLength(columns - 1);
        expect(lines).toHaveLength(columns >= 120 ? 2 : columns >= 80 ? 3 : 6);
        for (const field of [
            "Minyami | Downloading",
            "3.9% 113/2918 chunks",
            "Speed: 261.99 Mbps",
            "Elapsed: 00:00:14",
            "ETA: 00:05:48",
            "Active: 16",
            "Queued: 2789",
            "Successful: 113",
            "Dropped: 0",
        ]) {
            expect(view).toContain(field);
        }
    });
});

function createController() {
    const events = new EventEmitter();
    const controller: DownloadController = {
        download: jest.fn<DownloadController["download"]>(),
        stop: jest.fn<DownloadController["stop"]>(),
        abort: jest.fn<DownloadController["abort"]>(),
        getSnapshot: jest.fn<DownloadController["getSnapshot"]>().mockReturnValue(createSnapshot()),
        on(event, listener) {
            events.on(event, listener);
            return controller;
        },
        once(event, listener) {
            events.once(event, listener);
            return controller;
        },
        off(event, listener) {
            events.off(event, listener);
            return controller;
        },
    };
    return { controller, events };
}

function createSnapshot(overrides: Partial<SourceDownloadSnapshot> = {}): SourceDownloadSnapshot {
    return {
        status: "downloading",
        sourcePath: "source.m3u8",
        tempPath: ".",
        outputBasePath: "output",
        outputPaths: [],
        artifacts: [],
        startedAt: 1000,
        completedChunkCount: 5,
        successfulChunkCount: 4,
        droppedChunkCount: 1,
        successfulDuration: 12,
        runningTaskCount: 2,
        pendingTaskCount: 3,
        totalChunkCount: 10,
        currentBytesPerSecond: 1_000_000,
        isEnd: false,
        tracks: [],
        ...overrides,
    };
}
