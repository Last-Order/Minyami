import { HLSSegment } from "@/core/source/hls/playlist/parser";
import { HLSAdaptationOptions } from "@/core/source/hls/types";
import { DownloadItemNamer } from "@/core/source/types";

export interface HLSSitePlan {
    readonly adaptSegments?: (segments: readonly HLSSegment[]) => readonly HLSSegment[];
    readonly itemNamer?: DownloadItemNamer;
}

export interface HLSSiteAdapter {
    readonly id: string;
    matches(options: HLSAdaptationOptions): boolean;
    prepare(options: HLSAdaptationOptions): HLSSitePlan | Promise<HLSSitePlan>;
}
