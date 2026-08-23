import { DownloadItem, DownloadSourceContext, DownloadSourceHttpClient } from "../../../types";
import { MediaContainer } from "../../../../media_container";
import { HLSExplicitKey } from "../../explicit_key";
import { HLSMediaPlaylist, HLSSegment } from "../../parser";
import { HLSMediaSegmentFormat } from "../segment_format";

export interface HLSProfilePrepareOptions {
    readonly playlist: HLSMediaPlaylist;
    readonly explicitKeys: readonly HLSExplicitKey[];
    readonly http: DownloadSourceHttpClient;
}

export interface HLSProfilePlan {
    readonly id: string;
    readonly container: MediaContainer;

    /** Registers every key referenced by the effective snapshot before any corresponding item is yielded. */
    ensureKeys(playlist: HLSMediaPlaylist, context: DownloadSourceContext, signal: AbortSignal): Promise<void>;

    /** Resolves all HLS-specific encryption semantics before crossing the source boundary. */
    toDownloadItem(segment: HLSSegment): DownloadItem;
}

export interface HLSProfileAdapter {
    readonly id: string;
    /** Selects the profile once from the initial effective media playlist. */
    matches(playlist: HLSMediaPlaylist, format: HLSMediaSegmentFormat): boolean;
    prepare(options: HLSProfilePrepareOptions): HLSProfilePlan | Promise<HLSProfilePlan>;
}
