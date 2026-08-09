import logger from "../../../utils/log";
import { mergeAsyncIterables } from "../merge_async_iterables";
import { MediaTrack, StreamSelector, TrackSelection, validateTrackSelection } from "../stream_selection";
import { selectDefaultStream } from "../stream_selector";
import { DownloadSource, DownloadSourceContext, DownloadTrackId, SourceBatch, SourceMetadata } from "../types";
import { HLSMediaPlaylist, HLSPlaylistKind } from "./parser";
import { PlaylistLoader } from "./playlist_loader";
import { HLSMediaPlaylistCursor, HLSMediaPlaylistCursorMode, HLSSlice } from "./media_playlist_cursor";
import { createHLSStreamCatalogPlan, HLSStreamCatalogPlan } from "./stream_catalog";

export type HLSSourceMode = HLSMediaPlaylistCursorMode;

export interface HLSSourceOptions {
    mode: HLSSourceMode;
    streamSelector?: StreamSelector;
    slice?: HLSSlice;
}

interface SelectedHLSMediaTrack {
    readonly sourceTrackId: DownloadTrackId;
    readonly mediaTrack: MediaTrack;
    readonly sourcePath: string;
    readonly initialPlaylist?: HLSMediaPlaylist;
}

/** Resolves HLS manifests into protocol-neutral selected tracks and per-playlist cursors. */
export class HLSSource implements DownloadSource {
    readonly continuous: boolean;
    private loader?: PlaylistLoader;
    private cursors: readonly HLSMediaPlaylistCursor[] = [];
    private prepared = false;
    private cancelled = false;

    constructor(readonly sourcePath: string, private readonly options: HLSSourceOptions) {
        this.continuous = options.mode === "follow";
    }

    async prepare(context: DownloadSourceContext, signal: AbortSignal): Promise<SourceMetadata> {
        if (this.prepared) {
            throw new Error("This HLS source has already been prepared.");
        }
        if (!this.sourcePath) {
            throw new Error("Missing HLS source path.");
        }
        throwIfAborted(signal);
        this.loader = new PlaylistLoader(context.http);
        const selectedTracks = await this.selectMediaTracks(context, signal);
        if (!selectedTracks) {
            this.cancelled = true;
            this.prepared = true;
            return { cancelled: true };
        }

        this.cursors = await Promise.all(
            selectedTracks.map(async (selected) => {
                const playlist =
                    selected.initialPlaylist ?? (await this.loadSelectedMediaPlaylist(selected.sourcePath, context));
                return new HLSMediaPlaylistCursor({
                    id: selected.sourceTrackId,
                    mediaTrack: selected.mediaTrack,
                    sourcePath: selected.sourcePath,
                    mode: this.options.mode,
                    initialPlaylist: playlist,
                    loader: this.loader!,
                    slice: this.options.slice,
                });
            })
        );
        const tracks = await Promise.all(this.cursors.map((cursor) => cursor.prepare(context, signal)));
        this.prepared = true;
        return { tracks };
    }

    async *discover(context: DownloadSourceContext, signal: AbortSignal): AsyncIterable<SourceBatch> {
        if (!this.prepared) {
            throw new Error("HLS source must be prepared before discovering items.");
        }
        if (this.cancelled) {
            return;
        }
        if (this.cursors.length === 0) {
            throw new Error("HLS source has no prepared media-playlist cursors.");
        }

        const discoveryAbort = new AbortController();
        const onAbort = () => discoveryAbort.abort();
        signal.addEventListener("abort", onAbort, { once: true });
        try {
            const discoveries = this.cursors.map((cursor) => cursor.discover(context, discoveryAbort.signal));
            yield* mergeAsyncIterables(discoveries, () => discoveryAbort.abort());
        } finally {
            discoveryAbort.abort();
            signal.removeEventListener("abort", onAbort);
        }
    }

    private async selectMediaTracks(
        context: DownloadSourceContext,
        signal: AbortSignal
    ): Promise<readonly SelectedHLSMediaTrack[] | undefined> {
        const loaded = await this.loader!.load(this.sourcePath, {
            retries: context.retries,
            timeout: 60000,
        });
        throwIfAborted(signal);
        if (loaded.kind === HLSPlaylistKind.Media) {
            const mediaTrack = Object.freeze<MediaTrack>({ id: "main", type: "video" });
            return [
                {
                    sourceTrackId: "main",
                    mediaTrack,
                    sourcePath: this.sourcePath,
                    initialPlaylist: loaded,
                },
            ];
        }
        if (loaded.variants.length === 0) {
            throw new Error("Master playlist does not contain any stream options.");
        }

        const plan = createHLSStreamCatalogPlan(loaded);
        const selection = await this.selectTracks(plan);
        throwIfAborted(signal);
        if (!selection) {
            return undefined;
        }

        logger.info(`Master playlist input detected. Selected ${selection.length} media track(s).`);
        logger.debug(`Selected tracks: ${selection.map((track) => track.id).join(", ")}`);
        return selection.map((track) => {
            const mediaPlan = plan.mediaTracks.get(track);
            if (!mediaPlan) {
                throw new Error(`Missing HLS media plan for selected track ${track.id}.`);
            }
            return {
                sourceTrackId: mediaPlan.sourceTrackId,
                mediaTrack: track,
                sourcePath: mediaPlan.sourcePath,
            };
        });
    }

    private async selectTracks(plan: HLSStreamCatalogPlan): Promise<TrackSelection | undefined> {
        const selection = await (this.options.streamSelector ?? selectDefaultStream)(plan.catalog);
        if (!selection) {
            return undefined;
        }
        return validateTrackSelection(plan.catalog, selection);
    }

    private async loadSelectedMediaPlaylist(
        sourcePath: string,
        context: DownloadSourceContext
    ): Promise<HLSMediaPlaylist> {
        const playlist = await this.loader!.load(sourcePath, {
            retries: context.retries,
            timeout: 60000,
        });
        if (playlist.kind === HLSPlaylistKind.Master) {
            throw new Error(`Selected HLS track ${sourcePath} points to another master playlist.`);
        }
        return playlist;
    }
}

export function createHLSSource(sourcePath: string, options: HLSSourceOptions): HLSSource {
    return new HLSSource(sourcePath, options);
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new Error("Source preparation was aborted.");
    }
}
