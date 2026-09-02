import * as path from "path";
import { DownloadItem, DownloadTrackId, SourceBatch, SourceTrack } from "@/core/source/types";
import { DownloadTask } from "../execution/task";
import { mixedItemNamer } from "../output/item_naming";

export interface ManifestTrackSnapshot {
    readonly metadata: SourceTrack;
    readonly totalChunkCount: number;
    readonly completedChunkCount: number;
    readonly successfulChunkCount: number;
    readonly droppedChunkCount: number;
    readonly successfulDuration: number;
}

export interface DownloadManifestSnapshot {
    readonly startedAt: number;
    readonly totalChunkCount: number;
    readonly completedChunkCount: number;
    readonly successfulChunkCount: number;
    readonly droppedChunkCount: number;
    readonly successfulDuration: number;
    readonly tracks: readonly ManifestTrackSnapshot[];
}

interface ManifestTrack {
    readonly metadata: SourceTrack;
    nextTaskIndex: number;
    declaredTotalItemCount?: number;
    successfulChunkCount: number;
    droppedChunkCount: number;
    successfulDuration: number;
}

const TRACK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * The session's authoritative manifest. Discovery order, track totals, and
 * terminal outcomes are committed here so snapshots never join competing records.
 */
export class DownloadManifest {
    private readonly tracks = new Map<DownloadTrackId, ManifestTrack>();
    private nextTaskId = 0;
    private startedAtValue = 0;

    start(startedAt = Date.now()): void {
        this.startedAtValue = startedAt;
    }

    registerTracks(metadata: readonly SourceTrack[]): void {
        if (metadata.length === 0) {
            throw new Error("A prepared source must declare at least one track.");
        }

        const filesystemIds = new Set<string>();
        for (const track of metadata) {
            if (!TRACK_ID_PATTERN.test(track.id)) {
                throw new Error(`Invalid download track id: ${track.id}`);
            }
            // Track ids become directory and output suffixes, so uniqueness follows filesystem identity.
            const filesystemIdentity = track.id.toLowerCase();
            if (filesystemIds.has(filesystemIdentity)) {
                throw new Error(`Duplicate download track id: ${track.id}`);
            }
            filesystemIds.add(filesystemIdentity);
            this.tracks.set(track.id, {
                metadata: track,
                nextTaskIndex: 0,
                successfulChunkCount: 0,
                droppedChunkCount: 0,
                successfulDuration: 0,
            });
        }
    }

    discover(batch: SourceBatch, validateItem: (item: DownloadItem) => void): readonly DownloadTask[] {
        const track = this.requireTrack(batch.trackId);
        const nextTaskIndex = track.nextTaskIndex + batch.items.length;

        const firstTaskId = this.nextTaskId;
        const firstTrackIndex = track.nextTaskIndex;
        // Build the whole batch before advancing either ordering frontier.
        const tasks = batch.items.map((item, itemIndex): DownloadTask => {
            validateItem(item);
            const id = firstTaskId + itemIndex;
            const trackIndex = firstTrackIndex + itemIndex;
            const filename = (track.metadata.itemNamer ?? mixedItemNamer)(item, {
                taskId: id,
                trackId: batch.trackId,
                trackIndex,
            });
            this.validateFilename(batch.trackId, filename);
            return {
                id,
                trackId: batch.trackId,
                trackIndex,
                item,
                filename,
            };
        });

        this.nextTaskId += tasks.length;
        track.nextTaskIndex = nextTaskIndex;
        if (batch.totalItemCount !== undefined) {
            track.declaredTotalItemCount = batch.totalItemCount;
        }
        return tasks;
    }

    recordSuccessful(task: DownloadTask): void {
        const track = this.tracks.get(task.trackId)!;
        track.successfulChunkCount++;
        // Initialization items affect task progress but have no playable duration.
        track.successfulDuration += task.item.kind === "media" ? task.item.duration : 0;
    }

    recordDropped(task: DownloadTask): void {
        this.tracks.get(task.trackId)!.droppedChunkCount++;
    }

    expectedTaskCounts(): ReadonlyMap<DownloadTrackId, number> {
        // Discovery order, not a source estimate, defines the exact output terminal frontier.
        return new Map([...this.tracks].map(([trackId, track]) => [trackId, track.nextTaskIndex]));
    }

    getTrack(trackId: DownloadTrackId): SourceTrack {
        return this.tracks.get(trackId)!.metadata;
    }

    get snapshot(): DownloadManifestSnapshot {
        const tracks = [...this.tracks.values()].map((track): ManifestTrackSnapshot => {
            const completedChunkCount = track.successfulChunkCount + track.droppedChunkCount;
            return {
                metadata: track.metadata,
                // Continuous sources grow from discovered count; finite sources may publish their final total early.
                totalChunkCount: track.declaredTotalItemCount ?? track.nextTaskIndex,
                completedChunkCount,
                successfulChunkCount: track.successfulChunkCount,
                droppedChunkCount: track.droppedChunkCount,
                successfulDuration: track.successfulDuration,
            };
        });
        const aggregate = tracks.reduce(
            (result, track) => ({
                totalChunkCount: result.totalChunkCount + track.totalChunkCount,
                completedChunkCount: result.completedChunkCount + track.completedChunkCount,
                successfulChunkCount: result.successfulChunkCount + track.successfulChunkCount,
                droppedChunkCount: result.droppedChunkCount + track.droppedChunkCount,
                successfulDuration: result.successfulDuration + track.successfulDuration,
            }),
            {
                totalChunkCount: 0,
                completedChunkCount: 0,
                successfulChunkCount: 0,
                droppedChunkCount: 0,
                successfulDuration: 0,
            },
        );
        return { startedAt: this.startedAtValue, tracks, ...aggregate };
    }

    successfulChunksPerSecond(): string {
        return (this.snapshot.successfulChunkCount / this.elapsedSeconds()).toFixed(2);
    }

    successfulDurationRatio(): string {
        // Multiple tracks report aggregate media throughput, not presentation duration.
        return (this.snapshot.successfulDuration / this.elapsedSeconds()).toFixed(2);
    }

    completionEta(): string {
        const { completedChunkCount, totalChunkCount } = this.snapshot;
        if (completedChunkCount === 0) {
            return "--";
        }
        const usedTime = Date.now() - this.startedAtValue;
        const remainingSeconds = Math.max(
            0,
            Math.round(((usedTime / completedChunkCount) * totalChunkCount - usedTime) / 1000),
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

    private validateFilename(trackId: DownloadTrackId, filename: string): void {
        // Source-provided namers may label files but cannot escape the downloader-owned track directory.
        if (
            !filename ||
            filename === "." ||
            filename === ".." ||
            path.isAbsolute(filename) ||
            filename.includes("/") ||
            filename.includes("\\")
        ) {
            throw new Error(`Invalid output filename for track ${trackId}: ${filename}`);
        }
    }

    private requireTrack(trackId: DownloadTrackId): ManifestTrack {
        const track = this.tracks.get(trackId);
        if (!track) {
            throw new Error(`Source yielded a batch for unknown track: ${trackId}`);
        }
        return track;
    }

    private elapsedSeconds(): number {
        return Math.max(1, Math.round((Date.now() - this.startedAtValue) / 1000));
    }
}
