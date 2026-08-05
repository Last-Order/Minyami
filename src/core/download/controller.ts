export type DownloadStatus = "idle" | "preparing" | "downloading" | "stopping" | "merging" | "finished" | "failed";

export type DownloadEvent =
    | "parsed"
    | "chunk-downloaded"
    | "chunk-error"
    | "downloaded"
    | "finished"
    | "critical-error";

export type DownloadEventListener = (...args: any[]) => void;

export interface ChunkDownloadedInfo {
    taskName: string;
    completedChunkCount: number;
    successfulChunkCount: number;
    droppedChunkCount: number;
    totalChunkCount: number;
    successfulChunksPerSecond: string;
    successfulDurationRatio: string;
    completionEta?: string;
}

export interface DownloadSnapshot {
    status: DownloadStatus;
    sourcePath: string;
    tempPath: string;
    outputPath: string;
    startedAt: number;
    completedChunkCount: number;
    successfulChunkCount: number;
    droppedChunkCount: number;
    successfulDuration: number;
    runningTaskCount: number;
    pendingTaskCount: number;
}
