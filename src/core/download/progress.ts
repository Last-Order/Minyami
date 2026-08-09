import { DownloadTask } from "../downloader";
import { DownloadTrackId } from "../source/types";

export interface TrackProgressSnapshot {
    completedChunkCount: number;
    successfulChunkCount: number;
    droppedChunkCount: number;
    successfulDuration: number;
}

export interface ProgressSnapshot extends TrackProgressSnapshot {
    startedAt: number;
}

interface MutableTrackProgress {
    successfulChunkCount: number;
    droppedChunkCount: number;
    successfulDuration: number;
}

function createTrackProgress(): MutableTrackProgress {
    return {
        successfulChunkCount: 0,
        droppedChunkCount: 0,
        successfulDuration: 0,
    };
}

export class ProgressTracker {
    private startedAtValue = 0;
    private readonly tracks = new Map<DownloadTrackId, MutableTrackProgress>();

    start(startedAt = Date.now()): void {
        this.startedAtValue = startedAt;
    }

    registerTracks(trackIds: readonly DownloadTrackId[]): void {
        for (const trackId of trackIds) {
            if (this.tracks.has(trackId)) {
                throw new Error(`Progress track already registered: ${trackId}`);
            }
            this.tracks.set(trackId, createTrackProgress());
        }
    }

    recordSuccessful(task: DownloadTask): void {
        const track = this.requireTrack(task.trackId);
        track.successfulChunkCount++;
        track.successfulDuration += task.item.kind === "media" ? task.item.duration : 0;
    }

    recordDropped(task: DownloadTask): void {
        this.requireTrack(task.trackId).droppedChunkCount++;
    }

    get snapshot(): ProgressSnapshot {
        const aggregate = [...this.tracks.values()].reduce(
            (result, track) => ({
                successfulChunkCount: result.successfulChunkCount + track.successfulChunkCount,
                droppedChunkCount: result.droppedChunkCount + track.droppedChunkCount,
                successfulDuration: result.successfulDuration + track.successfulDuration,
            }),
            createTrackProgress()
        );
        return {
            startedAt: this.startedAtValue,
            ...aggregate,
            completedChunkCount: aggregate.successfulChunkCount + aggregate.droppedChunkCount,
        };
    }

    getTrackSnapshot(trackId: DownloadTrackId): TrackProgressSnapshot {
        const track = this.requireTrack(trackId);
        return {
            successfulChunkCount: track.successfulChunkCount,
            droppedChunkCount: track.droppedChunkCount,
            completedChunkCount: track.successfulChunkCount + track.droppedChunkCount,
            successfulDuration: track.successfulDuration,
        };
    }

    get startedAt(): number {
        return this.startedAtValue;
    }

    get completedChunkCount(): number {
        return this.snapshot.completedChunkCount;
    }

    get successfulChunkCount(): number {
        return this.snapshot.successfulChunkCount;
    }

    get droppedChunkCount(): number {
        return this.snapshot.droppedChunkCount;
    }

    get successfulDuration(): number {
        return this.snapshot.successfulDuration;
    }

    successfulChunksPerSecond(): string {
        return (this.successfulChunkCount / this.elapsedSeconds()).toFixed(2);
    }

    successfulDurationRatio(): string {
        // For multiple tracks this is aggregate media throughput, not presentation duration.
        return (this.successfulDuration / this.elapsedSeconds()).toFixed(2);
    }

    completionEta(totalChunkCount: number): string {
        const completedChunkCount = this.completedChunkCount;
        if (completedChunkCount === 0) {
            return "--";
        }
        const usedTime = Date.now() - this.startedAtValue;
        const remainingSeconds = Math.max(
            0,
            Math.round(((usedTime / completedChunkCount) * totalChunkCount - usedTime) / 1000)
        );
        if (remainingSeconds < 60) {
            return `${remainingSeconds}s`;
        }
        if (remainingSeconds < 3600) {
            return `${Math.floor(remainingSeconds / 60)}m ${remainingSeconds % 60}s`;
        }
        return `${Math.floor(remainingSeconds / 3600)}h ${Math.floor((remainingSeconds % 3600) / 60)}m ${
            remainingSeconds % 60
        }s`;
    }

    private requireTrack(trackId: DownloadTrackId): MutableTrackProgress {
        const track = this.tracks.get(trackId);
        if (!track) {
            throw new Error(`Unknown progress track: ${trackId}`);
        }
        return track;
    }

    private elapsedSeconds(): number {
        return Math.max(1, Math.round((Date.now() - this.startedAtValue) / 1000));
    }
}
