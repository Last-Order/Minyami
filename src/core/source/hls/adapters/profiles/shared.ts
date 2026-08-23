import { DownloadEncryption, DownloadItem } from "../../../types";
import { HLSSegment, HLSSegmentKind } from "../../parser";

const HLS_MAP_PREFIX_SLOT = "hls-map";

export function toDownloadItem(segment: HLSSegment, encryption?: DownloadEncryption): DownloadItem {
    if (segment.kind === HLSSegmentKind.Initialization) {
        return {
            url: segment.url,
            kind: "init",
            output: {
                replayablePrefix: { slot: HLS_MAP_PREFIX_SLOT, identity: segment.initializationId },
                startsNewRun: true,
            },
            ...(segment.byteRange ? { byteRange: { ...segment.byteRange } } : {}),
            ...(encryption ? { encryption } : {}),
        };
    }
    return {
        url: segment.url,
        kind: "media",
        duration: segment.duration,
        ...(segment.initializationId
            ? {
                  output: {
                      requiredPrefixes: [{ slot: HLS_MAP_PREFIX_SLOT, identity: segment.initializationId }],
                  },
              }
            : {}),
        ...(segment.byteRange ? { byteRange: { ...segment.byteRange } } : {}),
        ...(encryption ? { encryption } : {}),
    };
}
