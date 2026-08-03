import { DownloadTask } from "../downloader";
import { isInitialChunk } from "../m3u8";

export interface ProgressSnapshot {
    startedAt: number;
    finishedChunkCount: number;
    finishedChunkLength: number;
}

export class ProgressTracker {
    private state: ProgressSnapshot = {
        startedAt: 0,
        finishedChunkCount: 0,
        finishedChunkLength: 0,
    };

    start(startedAt = Date.now()): void {
        this.state.startedAt = startedAt;
    }

    restore(snapshot: Partial<ProgressSnapshot>): void {
        this.state = { ...this.state, ...snapshot };
    }

    recordFinished(task: DownloadTask): void {
        this.state.finishedChunkCount++;
        if (!isInitialChunk(task.chunk)) {
            this.state.finishedChunkLength += task.chunk.length;
        }
    }

    recordDropped(): void {
        this.state.finishedChunkCount++;
    }

    get snapshot(): ProgressSnapshot {
        return { ...this.state };
    }

    get startedAt(): number {
        return this.state.startedAt;
    }

    get finishedChunkCount(): number {
        return this.state.finishedChunkCount;
    }

    get finishedChunkLength(): number {
        return this.state.finishedChunkLength;
    }

    speedByChunk(): string {
        return (this.state.finishedChunkCount / this.elapsedSeconds()).toFixed(2);
    }

    speedByRatio(): string {
        return (this.state.finishedChunkLength / this.elapsedSeconds()).toFixed(2);
    }

    eta(totalChunkCount: number): string {
        if (this.state.finishedChunkCount === 0) {
            return "--";
        }
        const usedTime = Date.now() - this.state.startedAt;
        const remainingSeconds = Math.max(
            0,
            Math.round(((usedTime / this.state.finishedChunkCount) * totalChunkCount - usedTime) / 1000)
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

    private elapsedSeconds(): number {
        return Math.max(1, Math.round((Date.now() - this.state.startedAt) / 1000));
    }
}
