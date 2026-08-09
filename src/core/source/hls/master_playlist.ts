import { HLSMasterPlaylist, HLSParseError, HLSParseOptions, HLSPlaylistKind, HLSVariant } from "./models";
import { findNextUri, getPlaylistLines, getTagBody, parseAttributeList, resolvePlaylistUri } from "./playlist_syntax";

const STREAM_TAG = "#EXT-X-STREAM-INF";

export function parseMasterPlaylist({ content, playlistUrl = "" }: HLSParseOptions): HLSMasterPlaylist {
    const lines = getPlaylistLines(content);
    const variants: HLSVariant[] = [];

    for (let index = 0; index < lines.length; index++) {
        const currentLine = lines[index];
        if (!currentLine.startsWith(STREAM_TAG)) {
            continue;
        }

        const uri = findNextUri(lines, index + 1);
        if (!uri) {
            throw new HLSParseError("Invalid HLS playlist.");
        }

        const attributes = parseAttributeList(getTagBody(currentLine));
        if (!attributes["BANDWIDTH"]) {
            // BANDWIDTH is required for every variant and drives automatic stream selection.
            throw new HLSParseError("Missing BANDWIDTH attribute for streams.");
        }
        variants.push(createVariant(attributes, resolvePlaylistUri(playlistUrl, uri)));
    }

    // EXT-X-MEDIA rendition groups are intentionally not part of the current parser feature set.
    return { kind: HLSPlaylistKind.Master, variants };
}

function createVariant(attributes: Record<string, string>, url: string): HLSVariant {
    const variant: HLSVariant = {
        url,
        bandwidth: +attributes["BANDWIDTH"],
        ...(attributes["CODECS"] ? { codecs: attributes["CODECS"] } : {}),
        ...(attributes["FRAME-RATE"] ? { frameRate: +attributes["FRAME-RATE"] } : {}),
    };
    const resolution = attributes["RESOLUTION"];
    if (!resolution || !resolution.includes("x")) {
        return variant;
    }
    const [width, height] = resolution.split("x").map((value) => parseInt(value));
    return { ...variant, resolution: { width, height } };
}
