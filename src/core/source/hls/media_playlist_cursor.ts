import logger from "../../../utils/log";
import { DownloadItem, DownloadSourceContext, DownloadTrackId, SourceBatch, SourceTrack } from "../types";
import { MediaTrack } from "../stream_selection";
import { HLSAdaptationPlan, prepareHLSAdaptation } from "./adapters/prepare";
import { HLSExplicitKey } from "./explicit_key";
import { HLSInitializationSegment, HLSMediaPlaylist, HLSPlaylistKind, HLSSegment, HLSSegmentKind } from "./parser";
import { PlaylistLoader } from "./playlist_loader";

export type HLSMediaPlaylistCursorMode = "snapshot" | "follow";

export interface HLSSlice {
    readonly start: number;
    readonly end: number;
}

export interface HLSMediaPlaylistCursorOptions {
    readonly id: DownloadTrackId;
    readonly mediaTrack: MediaTrack;
    readonly sourcePath: string;
    readonly mode: HLSMediaPlaylistCursorMode;
    readonly initialPlaylist: HLSMediaPlaylist;
    readonly loader: PlaylistLoader;
    readonly slice?: HLSSlice;
    readonly explicitKeys: readonly HLSExplicitKey[];
}

/**
 * Owns the refresh and discovery state for exactly one HLS Media Playlist.
 * Sequence identities are playlist-local, so every future rendition needs its own cursor.
 */
export class HLSMediaPlaylistCursor {
    private readonly initialSegmentIdentities = new Set<string>();
    private readonly sequenceIds = new Set<number>();
    private playlist: HLSMediaPlaylist;
    private adaptationPlan?: HLSAdaptationPlan;
    private timeout = 60000;
    private prepared = false;
    private discoveredItemCount = 0;

    constructor(private readonly options: HLSMediaPlaylistCursorOptions) {
        this.playlist = options.initialPlaylist;
    }

    async prepare(context: DownloadSourceContext, signal: AbortSignal): Promise<SourceTrack> {
        if (this.prepared) {
            throw new Error(`HLS media-playlist cursor ${this.options.id} has already been prepared.`);
        }
        throwIfAborted(signal);
        if (this.continuous) {
            this.updateFollowTimeouts();
        }
        const adaptation = await prepareHLSAdaptation({
            sourcePath: this.options.sourcePath,
            playlist: this.playlist,
            explicitKeys: this.options.explicitKeys,
            http: context.http,
        });
        this.playlist = adaptation.playlist;
        this.adaptationPlan = adaptation.plan;
        // Items may execute as soon as discovery yields, so known keys must be ready first.
        await this.adaptationPlan.ensureKeys(this.playlist, context, signal);
        this.prepared = true;

        return {
            id: this.options.id,
            mediaTrack: this.options.mediaTrack,
            sourcePath: this.options.sourcePath,
            ...(this.adaptationPlan.itemNamer ? { itemNamer: this.adaptationPlan.itemNamer } : {}),
            itemTimeout: this.continuous ? this.followItemTimeout : undefined,
        };
    }

    async *discover(context: DownloadSourceContext, signal: AbortSignal): AsyncIterable<SourceBatch> {
        if (!this.prepared) {
            throw new Error(`HLS media-playlist cursor ${this.options.id} must be prepared before discovery.`);
        }
        if (!this.adaptationPlan) {
            throw new Error(`HLS media-playlist cursor ${this.options.id} has no adaptation plan.`);
        }

        if (!this.continuous) {
            // Snapshot cursors know their final per-track total and yield once even when empty.
            const items = sliceItems(this.toItems(this.playlist.segments), this.options.slice);
            this.discoveredItemCount = items.length;
            this.logDiscovery(items.length);
            yield { trackId: this.options.id, items, totalItemCount: items.length };
            return;
        }

        while (!signal.aborted) {
            // Each refresh is a snapshot; cursor-local identities suppress earlier segments.
            const streamEnded = this.playlist.hasEndList;
            const segments = this.takeNewSegments(this.playlist.segments);
            const items = this.toItems(segments);
            this.discoveredItemCount += items.length;
            this.logDiscovery(items.length);
            if (items.length > 0) {
                yield { trackId: this.options.id, items };
            }

            if (streamEnded) {
                // ENDLIST closes only this cursor; the source waits for other selected tracks independently.
                logger.info(`Stream track ${this.options.id} ended. Waiting for current tasks finished.`);
                return;
            }

            logger.debug(`Cool down track ${this.options.id}... Wait for next check`);
            if (!(await waitForNextCheck(Math.min(5000, this.safeChunkLength * 1000), signal))) {
                return;
            }

            try {
                this.playlist = this.adaptationPlan.adaptPlaylist(await this.loadMediaPlaylist(signal));
                await this.adaptationPlan.ensureKeys(this.playlist, context, signal);
            } catch (error) {
                if (signal.aborted) {
                    return;
                }
                // Before useful output a refresh failure is fatal; afterwards an unavailable live manifest ends the track.
                if (this.discoveredItemCount === 0) {
                    throw error;
                }
                const status = (error as any)?.response?.status;
                if (status >= 400 && status <= 599) {
                    logger.info(`HLS playlist for track ${this.options.id} is no longer available.`);
                    return;
                }
                logger.warning(
                    `Unable to refresh track ${this.options.id}. Keep the current playlist and retry later.`
                );
            }
        }
    }

    private get continuous(): boolean {
        return this.options.mode === "follow";
    }

    private get safeChunkLength(): number {
        const chunkLength = this.playlist.averageSegmentDuration;
        return Number.isFinite(chunkLength) && chunkLength > 0 ? chunkLength : 5;
    }

    private get followItemTimeout(): number {
        return Math.min(this.safeChunkLength * 1000 * 20, 60000);
    }

    private logDiscovery(itemCount: number): void {
        logger.info(`Discovered ${itemCount} chunk(s) for track ${this.options.id}.`);
    }

    private updateFollowTimeouts(): void {
        this.timeout = Math.min(Math.max(20000, this.playlist.segments.length * this.safeChunkLength * 1000), 60000);
    }

    private async loadMediaPlaylist(signal: AbortSignal): Promise<HLSMediaPlaylist> {
        const loaded = await this.options.loader.load(this.options.sourcePath, {
            timeout: this.timeout,
            signal,
        });
        if (loaded.kind === HLSPlaylistKind.Master) {
            throw new Error("Selected HLS stream points to another master playlist.");
        }
        return loaded;
    }

    private takeNewSegments(segments: readonly HLSSegment[]): HLSSegment[] {
        return segments.filter((segment) => {
            if (segment.kind === HLSSegmentKind.Media) {
                // Media sequence is canonical only inside this media playlist.
                if (this.sequenceIds.has(segment.sequenceId)) {
                    return false;
                }
                this.sequenceIds.add(segment.sequenceId);
                return true;
            }
            const identity = initializationSegmentIdentity(segment);
            if (this.initialSegmentIdentities.has(identity)) {
                return false;
            }
            this.initialSegmentIdentities.add(identity);
            return true;
        });
    }

    private toItems(segments: readonly HLSSegment[]): DownloadItem[] {
        const plan = this.adaptationPlan;
        if (!plan) {
            throw new Error(`HLS media-playlist cursor ${this.options.id} has no adaptation plan.`);
        }
        return segments.map((segment) => plan.toDownloadItem(segment));
    }
}

function initializationSegmentIdentity(segment: HLSInitializationSegment): string {
    return JSON.stringify([segment.url, segment.byteRange?.offset, segment.byteRange?.length]);
}

function sliceItems(items: DownloadItem[], slice?: HLSSlice): DownloadItem[] {
    if (!slice) {
        return items;
    }

    const selected: DownloadItem[] = [];
    let currentTime = 0;
    for (const item of items) {
        if (currentTime >= slice.end) {
            break;
        }
        if (item.kind === "init") {
            // A fragmented-MP4 range is unusable without its initialization segment.
            selected.push(item);
            continue;
        }
        const itemStart = currentTime;
        const itemEnd = currentTime + item.duration;
        currentTime = itemEnd;
        if (itemEnd > slice.start && itemStart < slice.end) {
            selected.push(item);
        }
    }
    return selected;
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new Error("Source preparation was aborted.");
    }
}

function waitForNextCheck(milliseconds: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) {
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        const eventSignal = signal as AbortSignal & {
            addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
            removeEventListener(type: "abort", listener: () => void): void;
        };
        const onAbort = () => {
            clearTimeout(timer);
            resolve(false);
        };
        const timer = setTimeout(() => {
            eventSignal.removeEventListener("abort", onAbort);
            resolve(true);
        }, milliseconds);
        eventSignal.addEventListener("abort", onAbort, { once: true });
    });
}
