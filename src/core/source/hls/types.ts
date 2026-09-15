import type { MediaContainer } from "@/core/media_container";
import type { MediaTrack, StreamCatalog, StreamSelector } from "@/core/source/stream_selection";
import type {
    DownloadItem,
    DownloadItemNamer,
    DownloadSourceContext,
    DownloadSourceHttpClient,
    DownloadTrackId,
} from "@/core/source/types";
import type { HLSMediaPlaylist, HLSSegment } from "./playlist/models";

export interface HLSExplicitKey {
    readonly kid?: string;
    readonly key: string;
}

export type HLSSourceMode = "snapshot" | "follow";

export interface HLSSlice {
    readonly start: number;
    readonly end: number;
}

export interface HLSSourceOptions {
    mode: HLSSourceMode;
    streamSelector?: StreamSelector;
    slice?: HLSSlice;
    explicitKeys?: readonly HLSExplicitKey[];
}

export interface HLSMediaTrackPlan {
    readonly sourceTrackId: DownloadTrackId;
    readonly sourcePath: string;
}

export interface HLSStreamCatalogPlan {
    readonly catalog: StreamCatalog;
    readonly mediaTracks: ReadonlyMap<MediaTrack, HLSMediaTrackPlan>;
}

export interface HLSAdaptationOptions {
    readonly sourcePath: string;
    readonly playlist: HLSMediaPlaylist;
    readonly explicitKeys: readonly HLSExplicitKey[];
    readonly http: DownloadSourceHttpClient;
}

export interface HLSAdaptationPlan {
    readonly profileId: string;
    readonly container: MediaContainer;
    readonly siteId?: string;
    readonly itemNamer?: DownloadItemNamer;
    adaptPlaylist(playlist: HLSMediaPlaylist): HLSMediaPlaylist;
    ensureKeys(playlist: HLSMediaPlaylist, context: DownloadSourceContext): Promise<void>;
    toDownloadItem(segment: HLSSegment): DownloadItem;
}
