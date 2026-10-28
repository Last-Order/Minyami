import { DownloadStatus, SourceDownloadSnapshot } from "@/core/download/controller";

const STATUS_LABELS: Record<DownloadStatus, string> = {
    idle: "Waiting",
    preparing: "Preparing",
    downloading: "Downloading",
    stopping: "Stopping",
    merging: "Merging / muxing",
    finished: "Finished",
    aborted: "Aborted",
    failed: "Failed",
};
const FIELD_SEPARATOR = " | ";

/** A bounded view keeps terminal drawing separate from download accounting. */
export function renderDownloadProgress(
    snapshot: SourceDownloadSnapshot,
    live: boolean,
    columns: number,
    rows: number,
    now = Date.now(),
): readonly string[] {
    // Reserve the trailing cell and cursor line to avoid implicit terminal wrapping or scrolling.
    const width = Math.max(1, columns - 1);
    const elapsed = snapshot.startedAt > 0 ? Math.max(0, (now - snapshot.startedAt) / 1000) : 0;
    const { completedChunkCount: completed, totalChunkCount: total } = snapshot;
    const remaining = completed > 0 ? (elapsed * Math.max(0, total - completed)) / completed : undefined;
    const showEta = !live && snapshot.status === "downloading";
    const title = `Minyami | ${live ? "LIVE | " : ""}${STATUS_LABELS[snapshot.status]}`;
    const summaryWidth = width - title.length - FIELD_SEPARATOR.length;
    const summary = (available: number) =>
        live ? `Chunks: ${completed} / ${total} discovered` : progressSummary(completed, total, available);
    const compactSummary = summary(summaryWidth);
    const lines = packFields([title, compactSummary.length <= summaryWidth ? compactSummary : summary(width)], width);
    lines.push(
        ...packFields(
            [
                `Speed: ${(((snapshot.currentBytesPerSecond ?? 0) * 8) / 1_000_000).toFixed(2)} Mbps`,
                `Elapsed: ${formatDuration(elapsed)}`,
                `ETA: ${showEta && remaining !== undefined ? formatDuration(remaining) : "--"}`,
                `Active: ${snapshot.runningTaskCount}`,
                `Queued: ${snapshot.pendingTaskCount}`,
                `Successful: ${snapshot.successfulChunkCount}`,
                `Dropped: ${snapshot.droppedChunkCount}`,
            ],
            width,
        ),
    );
    if (live) {
        lines.push(...packFields(["Ctrl+C: finish known tasks", "again: abort"], width));
    }
    // All fields are generated ASCII; source metadata never enters the terminal layout.
    return lines.slice(0, Math.max(1, rows - 1)).map((line) => line.slice(0, width));
}

function progressSummary(completed: number, total: number, width: number): string {
    const ratio = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;
    const percentage = `${(ratio * 100).toFixed(1)}%`;
    const counts = `${completed}/${total} chunks`;
    // Reserve labels and counters first so the bar fills the remaining width without hiding progress.
    const size = width - `Total [] ${percentage} ${counts}`.length;
    if (size < 4) {
        return `Total ${percentage} ${counts}`;
    }
    const filled = Math.round(ratio * size);
    return `Total [${"#".repeat(filled)}${"-".repeat(size - filled)}] ${percentage} ${counts}`;
}

function packFields(fields: readonly string[], width: number): string[] {
    const lines: string[] = [];
    let line = "";
    for (const field of fields) {
        const joined = line ? `${line}${FIELD_SEPARATOR}${field}` : field;
        // Keep each label with its value; actual field widths also account for growing counters.
        if (line && joined.length > width) {
            lines.push(line);
            line = field;
        } else {
            line = joined;
        }
    }
    if (line) {
        lines.push(line);
    }
    return lines;
}

function formatDuration(seconds: number): string {
    const value = Math.max(0, Math.round(seconds));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    return [hours, minutes, value % 60].map((part) => part.toString().padStart(2, "0")).join(":");
}
