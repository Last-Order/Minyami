import { DownloadEncryption, DownloadItem } from "../../../types";
import { HLSSegment, HLSSegmentKind } from "../../parser";

export function toDownloadItem(segment: HLSSegment, encryption?: DownloadEncryption): DownloadItem {
    if (segment.kind === HLSSegmentKind.Initialization) {
        return {
            url: segment.url,
            kind: "init",
            ...(segment.byteRange ? { byteRange: { ...segment.byteRange } } : {}),
            ...(encryption ? { encryption } : {}),
        };
    }
    return {
        url: segment.url,
        kind: "media",
        duration: segment.duration,
        ...(segment.byteRange ? { byteRange: { ...segment.byteRange } } : {}),
        ...(encryption ? { encryption } : {}),
    };
}
