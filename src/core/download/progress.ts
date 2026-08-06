import { DownloadTask } from "../downloader";

export interface ProgressSnapshot {
    startedAt: number;
    completedChunkCount: number;
    successfulChunkCount: number;
    droppedChunkCount: number;
    successfulDuration: number;
}

export class ProgressTracker {
    private state = {
        startedAt: 0,
        successfulChunkCount: 0,
        droppedChunkCount: 0,
        successfulDuration: 0,
    };

    start(startedAt = Date.now()): void {
        this.state.startedAt = startedAt;
    }

    recordSuccessful(task: DownloadTask): void {
        this.state.successfulChunkCount++;
        this.state.successfulDuration += task.item.kind === "media" ? task.item.duration : 0;
    }

    recordDropped(): void {
        this.state.droppedChunkCount++;
    }

    get snapshot(): ProgressSnapshot {
        return {
            ...this.state,
            completedChunkCount: this.completedChunkCount,
        };
    }

    get startedAt(): number {
        return this.state.startedAt;
    }

    get completedChunkCount(): number {
        return this.state.successfulChunkCount + this.state.droppedChunkCount;
    }

    get successfulChunkCount(): number {
        return this.state.successfulChunkCount;
    }

    get droppedChunkCount(): number {
        return this.state.droppedChunkCount;
    }

    get successfulDuration(): number {
        return this.state.successfulDuration;
    }

    successfulChunksPerSecond(): string {
        return (this.state.successfulChunkCount / this.elapsedSeconds()).toFixed(2);
    }

    successfulDurationRatio(): string {
        return (this.state.successfulDuration / this.elapsedSeconds()).toFixed(2);
    }

    completionEta(totalChunkCount: number): string {
        const completedChunkCount = this.completedChunkCount;
        if (completedChunkCount === 0) {
            return "--";
        }
        const usedTime = Date.now() - this.state.startedAt;
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

    private elapsedSeconds(): number {
        return Math.max(1, Math.round((Date.now() - this.state.startedAt) / 1000));
    }
}
