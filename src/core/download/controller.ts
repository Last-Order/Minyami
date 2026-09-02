import { MediaTrack } from "../source/stream_selection";
import { DownloadTrackId } from "../source/types";

/** Graceful stop can finish normally; only a hard abort produces `aborted`. */
export type DownloadStatus =
    "idle" | "preparing" | "downloading" | "stopping" | "merging" | "finished" | "aborted" | "failed";

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

export interface DownloadEventMap {
    parsed: [];
    "chunk-downloaded": [info: ChunkDownloadedInfo];
    "chunk-error": [error: unknown, taskName: string, trackId: DownloadTrackId];
    /** All accepted tasks are terminal; merge/finalization may still be running. */
    downloaded: [];
    /** The session reached a stable finished or aborted state. */
    finished: [];
    "critical-error": [error: unknown];
}

export type DownloadEvent = keyof DownloadEventMap;

export type DownloadEventListener<TEvent extends DownloadEvent> = (...args: DownloadEventMap[TEvent]) => void;

export interface DownloadTrackSnapshot {
    id: DownloadTrackId;
    /** Logical media metadata preserved from stream selection through output. */
    mediaTrack: MediaTrack;
    sourcePath: string;
    plannedOutputPath: string;
    /** Retained merged paths; cleared when a successful cross-track mux consumes them. */
    outputPaths: readonly string[];
    totalChunkCount: number;
    completedChunkCount: number;
    successfulChunkCount: number;
    droppedChunkCount: number;
    successfulDuration: number;
}

/** A concentrated physical track retained after output finalization. */
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
    /** Configured output basename after a recognized video extension is removed. */
    outputBasePath: string;
    /** Final paths flattened in declared track order and then split-output order. */
    outputPaths: readonly string[];
    /** Per-track artifacts that remain on disk after optional muxing and cleanup. */
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

export interface SourceDownloadSnapshot extends DownloadSnapshot {
    totalChunkCount: number;
    /** True after discovery has exhausted, been cancelled, or failed terminally. */
    isEnd: boolean;
}
