import { DownloadItemNamer, DownloadSourceHttpClient } from "@/core/source/types";
import { HLSExplicitKey } from "@/core/source/hls/explicit_key";
import { HLSMediaPlaylist, HLSSegment } from "@/core/source/hls/playlist/parser";

export interface HLSSiteAdapterOptions {
    readonly sourcePath: string;
    readonly playlist: HLSMediaPlaylist;
    readonly explicitKeys: readonly HLSExplicitKey[];
    readonly http: DownloadSourceHttpClient;
}

export interface HLSSitePlan {
    readonly adaptSegments?: (segments: readonly HLSSegment[]) => readonly HLSSegment[];
    readonly itemNamer?: DownloadItemNamer;
}

export interface HLSSiteAdapter {
    readonly id: string;
    matches(options: HLSSiteAdapterOptions): boolean;
    prepare(options: HLSSiteAdapterOptions): HLSSitePlan | Promise<HLSSitePlan>;
}
