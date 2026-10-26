import { DownloadTransfer } from "../infrastructure/http_client";

const WINDOW_MS = 5_000;

/** Estimates recent throughput from completed chunk sizes without sampling in-flight transfers. */
export class BandwidthMonitor {
    private startedAt = 0;
    private samples: DownloadTransfer[] = [];

    constructor(private readonly now: () => number = () => performance.now()) {}

    start(): void {
        this.startedAt = this.now();
        this.samples = [];
    }

    recordChunk(transfer: DownloadTransfer): void {
        this.prune(this.now());
        this.samples.push(transfer);
    }

    bytesPerSecond(): number {
        const now = this.now();
        this.prune(now);
        // During startup use elapsed time; a monotonic clock keeps wall-clock adjustments out of the rate.
        const elapsedMs = Math.max(1, Math.min(WINDOW_MS, now - this.startedAt));
        const windowStart = now - elapsedMs;
        const bytes = this.samples.reduce((total, sample) => {
            // Spread each completed chunk over its download interval so long transfers cannot inflate the window.
            const durationMs = Math.max(1, sample.completedAt - sample.startedAt);
            const overlapMs = Math.max(
                0,
                Math.min(sample.completedAt, now) - Math.max(sample.completedAt - durationMs, windowStart),
            );
            return total + (sample.bytes * overlapMs) / durationMs;
        }, 0);
        return (bytes * 1_000) / elapsedMs;
    }

    private prune(now: number): void {
        this.samples = this.samples.filter((sample) => sample.completedAt > now - WINDOW_MS);
    }
}
