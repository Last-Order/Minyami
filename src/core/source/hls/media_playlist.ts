import logger from "../../../utils/log";
import {
    HLSInitializationSegment,
    HLSMediaEncryption,
    HLSMediaPlaylist,
    HLSMediaSegment,
    HLSParseError,
    HLSParseOptions,
    HLSPlaylistKind,
    HLSSegment,
    HLSSegmentKind,
} from "./models";
import { findNextUri, getPlaylistLines, getTagBody, parseAttributeList, resolvePlaylistUri } from "./playlist_syntax";

const MEDIA_SEQUENCE_TAG = "#EXT-X-MEDIA-SEQUENCE";
const KEY_TAG = "#EXT-X-KEY";
const MAP_TAG = "#EXT-X-MAP";
const ENDLIST_TAG = "#EXT-X-ENDLIST";
const SEGMENT_TAG = "#EXTINF";

export function parseMediaPlaylist({ content, playlistUrl = "" }: HLSParseOptions): HLSMediaPlaylist {
    const lines = getPlaylistLines(content);
    const segments: HLSSegment[] = [];
    const encryptionKeyUrls = new Set<string>();
    let encryption: HLSMediaEncryption | undefined;
    let sequenceId = 0;
    let mediaSegmentCount = 0;
    let totalDuration = 0;
    let hasEndList = false;
    let warnedAboutEncryption = false;

    for (let index = 0; index < lines.length; index++) {
        const currentLine = lines[index];

        if (currentLine.startsWith(MEDIA_SEQUENCE_TAG)) {
            sequenceId = parseInt(getTagBody(currentLine));
            continue;
        }
        if (currentLine.startsWith(KEY_TAG)) {
            const result = parseEncryption(getTagBody(currentLine), playlistUrl, warnedAboutEncryption);
            encryption = result.encryption;
            warnedAboutEncryption = result.warned;
            if (encryption) {
                encryptionKeyUrls.add(encryption.keyUrl);
            }
            continue;
        }
        if (currentLine.startsWith(MAP_TAG)) {
            segments.push(parseInitializationSegment(getTagBody(currentLine), playlistUrl, encryption));
            continue;
        }
        if (currentLine.startsWith(ENDLIST_TAG)) {
            hasEndList = true;
            break;
        }
        if (currentLine.startsWith(SEGMENT_TAG)) {
            const segment = parseMediaSegment(lines, index, currentLine, playlistUrl, sequenceId, encryption);
            segments.push(segment);
            totalDuration += segment.duration;
            mediaSegmentCount++;
            // Media sequence numbers advance exactly once per media segment, never for initialization segments.
            sequenceId++;
        }
    }

    return {
        kind: HLSPlaylistKind.Media,
        segments,
        encryptionKeyUrls: [...encryptionKeyUrls],
        hasEndList,
        totalDuration,
        averageSegmentDuration: totalDuration / mediaSegmentCount,
    };
}

function parseEncryption(
    tagBody: string,
    playlistUrl: string,
    warned: boolean
): { encryption?: HLSMediaEncryption; warned: boolean } {
    const attributes = parseAttributeList(tagBody);
    const method = attributes["METHOD"];

    if (method === "AES-128") {
        const keyUri = attributes["URI"];
        if (!keyUri) {
            throw new HLSParseError("Missing URL for encryption key");
        }
        return {
            encryption: {
                method,
                keyUrl: resolvePlaylistUri(playlistUrl, keyUri),
                ...(attributes["IV"] ? { iv: parseIv(attributes["IV"]) } : {}),
            },
            warned,
        };
    }
    if (method === "NONE") {
        return { warned };
    }

    if (!warned) {
        logger.warning(`Unsupported encryption method: "${method}". Chunks will not be decrypted.`);
    }
    return { warned: true };
}

function parseIv(value: string): string {
    const match = value.match(/^0[xX]([0-9a-fA-F]{1,32})$/);
    if (!match) {
        throw new HLSParseError("Invalid IV for encryption key");
    }
    return match[1];
}

function parseInitializationSegment(
    tagBody: string,
    playlistUrl: string,
    encryption?: HLSMediaEncryption
): HLSInitializationSegment {
    const uri = parseAttributeList(tagBody)["URI"];
    if (!uri) {
        throw new HLSParseError("Missing URL for initialization segment");
    }
    if (!encryption) {
        return { kind: HLSSegmentKind.Initialization, url: resolvePlaylistUri(playlistUrl, uri) };
    }
    if (!encryption.iv) {
        // Initialization segments have no media sequence from which an omitted IV could be derived.
        throw new HLSParseError("Missing IV for encrypted initialization segment");
    }
    return {
        kind: HLSSegmentKind.Initialization,
        url: resolvePlaylistUri(playlistUrl, uri),
        encryption: { ...encryption, iv: encryption.iv },
    };
}

function parseMediaSegment(
    lines: string[],
    tagIndex: number,
    tagLine: string,
    playlistUrl: string,
    sequenceId: number,
    encryption?: HLSMediaEncryption
): HLSMediaSegment {
    const uri = findNextUri(lines, tagIndex + 1);
    if (!uri) {
        throw new HLSParseError("Invalid HLS playlist.");
    }
    return {
        kind: HLSSegmentKind.Media,
        url: resolvePlaylistUri(playlistUrl, uri),
        duration: parseFloat(getTagBody(tagLine).split(",")[0]) || 5.0,
        sequenceId,
        ...(encryption ? { encryption } : {}),
    };
}
