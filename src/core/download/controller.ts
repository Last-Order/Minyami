import { DownloadTrackId } from "../source/types";
import { MediaTrack } from "../source/stream_selection";

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
    /** Logical media metadata preserved from stream selection through output. */
    mediaTrack: MediaTrack;
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

/** A concentrated physical track ready for passthrough or a future cross-track muxer. */
export interface TrackArtifact {
    trackId: DownloadTrackId;
    mediaTrack: MediaTrack;
    sourcePath: string;
    outputPaths: readonly string[];
}

export interface DownloadSnapshot {
    status: DownloadStatus;
    /** Original source entry point; selected media-playlist URLs live on track snapshots. */
    sourcePath: string;
    tempPath: string;
    outputBasePath: string;
    /** Final paths flattened in declared track order and then split-output order. */
    outputPaths: readonly string[];
    /** Completed per-track artifacts carrying the same logical media metadata. */
    artifacts: readonly TrackArtifact[];
    tracks: readonly DownloadTrackSnapshot[];
    startedAt: number;
    completedChunkCount: number;
    successfulChunkCount: number;
    droppedChunkCount: number;
    successfulDuration: number;
    runningTaskCount: number;
    pendingTaskCount: number;
}
