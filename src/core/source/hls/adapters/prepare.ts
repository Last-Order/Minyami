import { DownloadItem, DownloadItemNamer, DownloadSourceContext, DownloadSourceHttpClient } from "../../types";
import { HLSExplicitKey } from "../explicit_key";
import { HLSMediaPlaylist, HLSSegment } from "../parser";
import { hlsProfiles } from "./profiles/registry";
import { HLSProfilePlan } from "./profiles/types";
import { hlsSiteAdapters } from "./sites/registry";

export interface HLSAdaptationOptions {
    readonly sourcePath: string;
    readonly playlist: HLSMediaPlaylist;
    readonly explicitKeys: readonly HLSExplicitKey[];
    readonly http: DownloadSourceHttpClient;
}

export interface HLSAdaptationPlan {
    readonly profileId: string;
    readonly container: HLSProfilePlan["container"];
    readonly siteId?: string;
    readonly itemNamer?: DownloadItemNamer;
    adaptPlaylist(playlist: HLSMediaPlaylist): HLSMediaPlaylist;
    ensureKeys(playlist: HLSMediaPlaylist, context: DownloadSourceContext, signal: AbortSignal): Promise<void>;
    toDownloadItem(segment: HLSSegment): DownloadItem;
}

export interface PreparedHLSAdaptation {
    readonly playlist: HLSMediaPlaylist;
    readonly plan: HLSAdaptationPlan;
}

export async function prepareHLSAdaptation(options: HLSAdaptationOptions): Promise<PreparedHLSAdaptation> {
    const matchingSiteAdapters = hlsSiteAdapters.filter((adapter) => adapter.matches(options));
    if (matchingSiteAdapters.length > 1) {
        throw new Error(`Expected at most one HLS site adapter, but found ${matchingSiteAdapters.length}.`);
    }
    const siteAdapter = matchingSiteAdapters[0];
    const sitePlan = siteAdapter ? await siteAdapter.prepare(options) : {};
    // The site is selected once, while its segment transform is reused for every refreshed snapshot.
    const adaptPlaylist = (playlist: HLSMediaPlaylist): HLSMediaPlaylist =>
        sitePlan.adaptSegments ? { ...playlist, segments: sitePlan.adaptSegments(playlist.segments) } : playlist;
    const playlist = adaptPlaylist(options.playlist);

    const matchingProfiles = hlsProfiles.filter((profile) => profile.matches(playlist));
    if (matchingProfiles.length !== 1) {
        throw new Error(`Expected exactly one HLS profile, but found ${matchingProfiles.length}.`);
    }
    // The profile plan is immutable for the cursor and owns all later key and item conversion.
    const profilePlan = await matchingProfiles[0].prepare({
        playlist,
        explicitKeys: options.explicitKeys,
        http: options.http,
    });

    return {
        playlist,
        plan: {
            profileId: profilePlan.id,
            container: profilePlan.container,
            ...(siteAdapter ? { siteId: siteAdapter.id } : {}),
            ...(sitePlan.itemNamer ? { itemNamer: sitePlan.itemNamer } : {}),
            adaptPlaylist,
            ensureKeys: profilePlan.ensureKeys,
            toDownloadItem: profilePlan.toDownloadItem,
        },
    };
}
