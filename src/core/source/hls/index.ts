import logger from "../../../utils/log";
import { mergeAsyncIterables } from "../merge_async_iterables";
import { MediaTrack, StreamSelector, TrackSelection, validateTrackSelection } from "../stream_selection";
import { selectDefaultStream } from "../stream_selector";
import { DownloadSource, DownloadSourceContext, DownloadTrackId, SourceBatch, SourceMetadata } from "../types";
import { HLSExplicitKey } from "./explicit_key";
import { HLSMediaPlaylist, HLSPlaylistKind } from "./parser";
import { PlaylistLoader } from "./playlist_loader";
import { HLSMediaPlaylistCursor, HLSMediaPlaylistCursorMode, HLSSlice } from "./media_playlist_cursor";
import { createHLSStreamCatalogPlan, HLSStreamCatalogPlan } from "./stream_catalog";

export type HLSSourceMode = HLSMediaPlaylistCursorMode;
export type { HLSExplicitKey } from "./explicit_key";

export interface HLSSourceOptions {
    mode: HLSSourceMode;
    streamSelector?: StreamSelector;
    slice?: HLSSlice;
    explicitKeys?: readonly HLSExplicitKey[];
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
        const selectedTracks = await this.selectMediaTracks(signal);
        if (!selectedTracks) {
            this.cancelled = true;
            this.prepared = true;
            return { cancelled: true };
        }

        // Each selected Media Playlist owns independent sequence/dedup state even when tracks share one master.
        this.cursors = await Promise.all(
            selectedTracks.map(async (selected) => {
                const playlist =
                    selected.initialPlaylist ?? (await this.loadSelectedMediaPlaylist(selected.sourcePath, signal));
                return new HLSMediaPlaylistCursor({
                    id: selected.sourceTrackId,
                    mediaTrack: selected.mediaTrack,
                    sourcePath: selected.sourcePath,
                    mode: this.options.mode,
                    initialPlaylist: playlist,
                    loader: this.loader!,
                    slice: this.options.slice,
                    explicitKeys: this.options.explicitKeys ?? [],
                });
            })
        );
        // All cursors resolve keys before any track metadata is published to the downloader.
        const preparedTracks = await Promise.all(this.cursors.map((cursor) => cursor.prepare(context, signal)));
        const container = preparedTracks[0].container;
        if (
            preparedTracks.some(
                (prepared) =>
                    prepared.container.name !== container.name || prepared.container.extension !== container.extension
            )
        ) {
            throw new Error("Selected HLS tracks use incompatible media containers.");
        }
        this.prepared = true;
        return { container, tracks: preparedTracks.map((prepared) => prepared.track) };
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
            // A failing rendition cancels its siblings so the downloader never finalizes a partial track set.
            yield* mergeAsyncIterables(discoveries, () => discoveryAbort.abort());
        } finally {
            discoveryAbort.abort();
            signal.removeEventListener("abort", onAbort);
        }
    }

    private async selectMediaTracks(signal: AbortSignal): Promise<readonly SelectedHLSMediaTrack[] | undefined> {
        const loaded = await this.loader!.load(this.sourcePath, {
            timeout: 60000,
            signal,
        });
        throwIfAborted(signal);
        if (loaded.kind === HLSPlaylistKind.Media) {
            // A direct Media Playlist has one synthetic track because no master metadata supplies an identity.
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

    private async loadSelectedMediaPlaylist(sourcePath: string, signal: AbortSignal): Promise<HLSMediaPlaylist> {
        const playlist = await this.loader!.load(sourcePath, {
            timeout: 60000,
            signal,
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
