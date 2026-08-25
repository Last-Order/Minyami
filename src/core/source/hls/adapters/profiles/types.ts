import { DownloadItem, DownloadSourceContext, DownloadSourceHttpClient } from "@/core/source/types";
import { MediaContainer } from "@/core/media_container";
import { HLSExplicitKey } from "@/core/source/hls/explicit_key";
import { HLSMediaPlaylist, HLSSegment } from "@/core/source/hls/playlist/parser";

export const SAMPLE_AES_EXPLICIT_KEY_REQUIRED = "This HLS content is protected. Provide an explicit decryption key.";

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
    prepare(options: HLSProfilePrepareOptions): HLSProfilePlan | Promise<HLSProfilePlan>;
}
