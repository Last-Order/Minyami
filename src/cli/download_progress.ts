import { Instance, render, Text } from "ink";
import { createElement } from "react";
import { DownloadController } from "@/core/download/downloader";
import logger from "@/utils/log";
import { renderDownloadProgress } from "./download_progress_view";

const REFRESH_INTERVAL_MS = 200;

/** Owns only terminal resources; snapshots remain the session's authoritative progress state. */
export function installCliDownloadProgress(downloader: DownloadController, live: boolean): () => void {
    // Both streams must share an interactive terminal so warnings cannot race redirected progress output.
    if (!process.stdout.isTTY || !process.stderr.isTTY || process.env.TERM === "dumb") {
        return () => undefined;
    }

    const terminal = process.stdout;
    let instance: Instance | undefined;
    let previousFrame = "";
    let timer: ReturnType<typeof setInterval> | undefined;
    let resumeProgressLogs: (() => void) | undefined;
    let disposed = false;

    const frame = () =>
        renderDownloadProgress(downloader.getSnapshot(), live, terminal.columns || 80, terminal.rows || 24).join("\n");
    const view = (text: string) => createElement(Text, { wrap: "truncate-end" }, text);
    const refresh = () => {
        if (!instance) {
            return;
        }
        const nextFrame = frame();
        if (nextFrame !== previousFrame) {
            instance.rerender(view(nextFrame));
            previousFrame = nextFrame;
        }
    };
    const start = () => {
        if (disposed || instance) {
            return;
        }
        // `parsed` follows interactive stream selection, which owns the terminal during preparation.
        previousFrame = frame();
        instance = render(view(previousFrame), {
            stdout: terminal,
            stderr: process.stderr,
            incrementalRendering: true,
            maxFps: 1000 / REFRESH_INTERVAL_MS,
            patchConsole: true,
            // Process signals remain owned by the CLI; a passive dashboard must not enable raw input.
            exitOnCtrlC: false,
            interactive: true,
        });
        resumeProgressLogs = logger.suppressProgressLogs();
        // Polling coalesces fast chunk completions and lets speed decay while no chunks complete.
        timer = setInterval(refresh, REFRESH_INTERVAL_MS);
        timer.unref();
        terminal.on("resize", refresh);
    };
    const dispose = () => {
        if (disposed) {
            return;
        }
        disposed = true;
        if (timer) {
            clearInterval(timer);
        }
        terminal.off("resize", refresh);
        downloader.off("parsed", start);
        downloader.off("downloaded", refresh);
        downloader.off("finished", dispose);
        downloader.off("critical-error", dispose);
        if (instance) {
            try {
                // Replace pending frames as well, so Ink's final flush cannot restore the dashboard on exit.
                instance.rerender(null);
            } finally {
                resumeProgressLogs?.();
                // Ink flushes the empty view, restores console output and releases its terminal resources.
                instance.unmount();
            }
        }
    };
    downloader.on("parsed", start);
    downloader.on("downloaded", refresh);
    downloader.on("finished", dispose);
    downloader.on("critical-error", dispose);
    return dispose;
}
