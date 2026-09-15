import { HLSMediaPlaylist } from "../playlist/parser";
import { HLSAdaptationOptions, HLSAdaptationPlan } from "../types";
import { selectHLSProfile } from "./profiles/selector";
import { hlsSiteAdapters } from "./sites/registry";

export interface PreparedHLSAdaptation {
    readonly playlist: HLSMediaPlaylist;
    readonly plan: HLSAdaptationPlan;
}

export async function prepareHLSAdaptation(options: HLSAdaptationOptions): Promise<PreparedHLSAdaptation> {
    const siteAdapter = hlsSiteAdapters.find((adapter) => adapter.matches(options));
    const sitePlan = siteAdapter ? await siteAdapter.prepare(options) : {};
    // The site is selected once, while its segment transform is reused for every refreshed snapshot.
    const adaptPlaylist = (playlist: HLSMediaPlaylist): HLSMediaPlaylist =>
        sitePlan.adaptSegments ? { ...playlist, segments: sitePlan.adaptSegments(playlist.segments) } : playlist;
    const playlist = adaptPlaylist(options.playlist);
    const profile = await selectHLSProfile(playlist, options.http);

    // The profile plan is immutable for the cursor and owns all later key and item conversion.
    const profilePlan = await profile.prepare({
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
