import { parseMasterPlaylist } from "./master";
import { parseMediaPlaylist } from "./media";
import { HLSParseOptions, HLSPlaylist } from "./models";
import { getPlaylistLines } from "./syntax";

export { HLSParseError, HLSPlaylistKind, HLSSegmentKind } from "./models";
export type {
    HLSAudioRendition,
    HLSAes128Encryption,
    HLSByteRange,
    HLSExternalKeyReference,
    HLSHttpKeyReference,
    HLSInlineKeyReference,
    HLSInitializationSegment,
    HLSKeyReference,
    HLSMasterPlaylist,
    HLSMediaEncryption,
    HLSMediaPlaylist,
    HLSMediaSegment,
    HLSSampleAesEncryption,
    HLSParseOptions,
    HLSPlaylist,
    HLSSegment,
    HLSVariant,
} from "./models";
export { HLSKeyReferenceKind } from "./models";

export function parseHLSPlaylist(options: HLSParseOptions): HLSPlaylist {
    return isMasterPlaylist(options.content) ? parseMasterPlaylist(options) : parseMediaPlaylist(options);
}

function isMasterPlaylist(content: string): boolean {
    return getPlaylistLines(content).some((line) => line.startsWith("#EXT-X-STREAM-INF"));
}
