export type DownloadStatus = "idle" | "preparing" | "downloading" | "stopping" | "merging" | "finished" | "failed";

export type DownloadEvent =
    | "parsed"
    | "chunk-downloaded"
    | "chunk-error"
    | "downloaded"
    | "finished"
    | "critical-error";

export type DownloadEventListener = (...args: any[]) => void;

export interface DownloadSnapshot {
    status: DownloadStatus;
    sourcePath?: string;
    tempPath: string;
    outputPath: string;
    startedAt: number;
    finishedChunkCount: number;
    finishedChunkLength: number;
    runningTaskCount: number;
    pendingTaskCount: number;
}
