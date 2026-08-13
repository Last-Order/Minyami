import { parseMasterPlaylist } from "./master_playlist";
import { parseMediaPlaylist } from "./media_playlist";
import { HLSParseOptions, HLSPlaylist } from "./models";
import { getPlaylistLines } from "./playlist_syntax";

export { HLSParseError, HLSPlaylistKind, HLSSegmentKind } from "./models";
export type {
    HLSAudioRendition,
    HLSByteRange,
    HLSInitializationEncryption,
    HLSInitializationSegment,
    HLSMasterPlaylist,
    HLSMediaEncryption,
    HLSMediaPlaylist,
    HLSMediaSegment,
    HLSParseOptions,
    HLSPlaylist,
    HLSSegment,
    HLSVariant,
} from "./models";

export function parseHLSPlaylist(options: HLSParseOptions): HLSPlaylist {
    return isMasterPlaylist(options.content) ? parseMasterPlaylist(options) : parseMediaPlaylist(options);
}

function isMasterPlaylist(content: string): boolean {
    return getPlaylistLines(content).some((line) => line.startsWith("#EXT-X-STREAM-INF"));
}
