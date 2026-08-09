import { DownloadTrackId } from "../source/types";

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
    trackId: DownloadTrackId;
    completedChunkCount: number;
    successfulChunkCount: number;
    droppedChunkCount: number;
    totalChunkCount: number;
    successfulChunksPerSecond: string;
    successfulDurationRatio: string;
    completionEta?: string;
}

export interface DownloadTrackSnapshot {
    id: DownloadTrackId;
    sourcePath: string;
    plannedOutputPath: string;
    /** Final paths are published only after this track has finished merging. */
    outputPaths: readonly string[];
    totalChunkCount: number;
    completedChunkCount: number;
    successfulChunkCount: number;
    droppedChunkCount: number;
    successfulDuration: number;
}

export interface DownloadSnapshot {
    status: DownloadStatus;
    /** Original source entry point; selected media-playlist URLs live on track snapshots. */
    sourcePath: string;
    tempPath: string;
    outputBasePath: string;
    /** Final paths flattened in declared track order and then split-output order. */
    outputPaths: readonly string[];
    tracks: readonly DownloadTrackSnapshot[];
    startedAt: number;
    completedChunkCount: number;
    successfulChunkCount: number;
    droppedChunkCount: number;
    successfulDuration: number;
    runningTaskCount: number;
    pendingTaskCount: number;
}
