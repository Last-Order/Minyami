import { DownloadItemNamer, DownloadSourceHttpClient } from "../../../types";
import { HLSExplicitKey } from "../../explicit_key";
import { HLSMediaPlaylist, HLSSegment } from "../../parser";

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
