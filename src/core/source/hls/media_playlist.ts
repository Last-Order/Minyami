import logger from "../../../utils/log";
import {
    HLSByteRange,
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
import { getPlaylistLines, getTagBody, parseAttributeList, resolvePlaylistUri } from "./playlist_syntax";

const MEDIA_SEQUENCE_TAG = "#EXT-X-MEDIA-SEQUENCE";
const KEY_TAG = "#EXT-X-KEY";
const MAP_TAG = "#EXT-X-MAP";
const BYTE_RANGE_TAG = "#EXT-X-BYTERANGE";
const ENDLIST_TAG = "#EXT-X-ENDLIST";
const I_FRAMES_ONLY_TAG = "#EXT-X-I-FRAMES-ONLY";
const SEGMENT_TAG = "#EXTINF";

interface ParsedByteRange {
    readonly length: number;
    readonly offset?: number;
}

interface PendingMediaSegment {
    duration?: number;
    byteRange?: ParsedByteRange;
}

const SEGMENT_NAMES: Record<HLSSegmentKind, string> = {
    [HLSSegmentKind.Initialization]: "initialization segment",
    [HLSSegmentKind.Media]: "media segment",
};

export function parseMediaPlaylist({ content, playlistUrl = "" }: HLSParseOptions): HLSMediaPlaylist {
    const lines = getPlaylistLines(content);
    const segments: HLSSegment[] = [];
    const encryptionKeyUrls = new Set<string>();
    let encryption: HLSMediaEncryption | undefined;
    let sequenceId = 0;
    let mediaSegmentCount = 0;
    let totalDuration = 0;
    let hasEndList = false;
    const hasIFramesOnly = lines.some((line) => line.startsWith(I_FRAMES_ONLY_TAG));
    let warnedAboutEncryption = false;
    const pending: PendingMediaSegment = {};
    let previousMediaSegment: HLSMediaSegment | undefined;

    for (const currentLine of lines) {
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
        if (currentLine.startsWith(BYTE_RANGE_TAG)) {
            if (pending.byteRange !== undefined) {
                throw new HLSParseError("Multiple byte ranges apply to one media segment");
            }
            pending.byteRange = parseByteRange(getTagBody(currentLine), HLSSegmentKind.Media);
            continue;
        }
        if (currentLine.startsWith(I_FRAMES_ONLY_TAG)) {
            continue;
        }
        if (currentLine.startsWith(ENDLIST_TAG)) {
            if (pending.duration !== undefined || pending.byteRange !== undefined) {
                throw new HLSParseError("Invalid HLS playlist.");
            }
            hasEndList = true;
            break;
        }
        if (currentLine.startsWith(SEGMENT_TAG)) {
            if (pending.duration !== undefined) {
                throw new HLSParseError("Multiple duration tags apply to one media segment");
            }
            pending.duration = parseFloat(getTagBody(currentLine).split(",")[0]) || 5.0;
            continue;
        }
        if (!currentLine.startsWith("#")) {
            if (pending.duration === undefined) {
                throw new HLSParseError("Missing duration for media segment");
            }
            const url = resolvePlaylistUri(playlistUrl, currentLine);
            let byteRange: HLSByteRange | undefined;
            if (pending.byteRange) {
                if (pending.byteRange.offset !== undefined) {
                    byteRange = { offset: pending.byteRange.offset, length: pending.byteRange.length };
                } else {
                    if (!previousMediaSegment?.byteRange || previousMediaSegment.url !== url) {
                        throw new HLSParseError("Cannot derive byte-range offset for media segment");
                    }
                    const offset = previousMediaSegment.byteRange.offset + previousMediaSegment.byteRange.length;
                    validateByteRange(offset, pending.byteRange.length, HLSSegmentKind.Media);
                    byteRange = { offset, length: pending.byteRange.length };
                }
            }
            const segment: HLSMediaSegment = {
                kind: HLSSegmentKind.Media,
                url,
                duration: pending.duration,
                sequenceId,
                ...(byteRange ? { byteRange } : {}),
                ...(encryption ? { encryption } : {}),
            };
            if (hasIFramesOnly && segment.encryption && segment.byteRange) {
                // AES-128 I-frame ranges need block-aligned widening and a preceding cipher block.
                throw new HLSParseError("Encrypted I-frame byte ranges are not supported");
            }
            segments.push(segment);
            previousMediaSegment = segment;
            totalDuration += segment.duration;
            mediaSegmentCount++;
            pending.duration = undefined;
            pending.byteRange = undefined;
            // Media sequence numbers advance exactly once per media segment, never for initialization segments.
            sequenceId++;
        }
    }

    if (!hasEndList && (pending.duration !== undefined || pending.byteRange !== undefined)) {
        throw new HLSParseError("Invalid HLS playlist.");
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
    const attributes = parseAttributeList(tagBody);
    const uri = attributes["URI"];
    if (!uri) {
        throw new HLSParseError("Missing URL for initialization segment");
    }
    let byteRange: HLSByteRange | undefined;
    if (attributes["BYTERANGE"]) {
        const parsedByteRange = parseByteRange(attributes["BYTERANGE"], HLSSegmentKind.Initialization);
        if (parsedByteRange.offset === undefined) {
            throw new HLSParseError("Missing byte-range offset for initialization segment");
        }
        byteRange = { offset: parsedByteRange.offset, length: parsedByteRange.length };
    }
    const base = {
        kind: HLSSegmentKind.Initialization,
        url: resolvePlaylistUri(playlistUrl, uri),
        ...(byteRange ? { byteRange } : {}),
    } as const;
    if (!encryption) {
        return base;
    }
    if (!encryption.iv) {
        // Initialization segments have no media sequence from which an omitted IV could be derived.
        throw new HLSParseError("Missing IV for encrypted initialization segment");
    }
    return {
        ...base,
        encryption: { ...encryption, iv: encryption.iv },
    };
}

function parseByteRange(value: string, kind: HLSSegmentKind): ParsedByteRange {
    const subject = SEGMENT_NAMES[kind];
    const match = value.match(/^([0-9]+)(?:@([0-9]+))?$/);
    if (!match) {
        throw new HLSParseError(`Invalid byte range for ${subject}`);
    }
    const length = Number(match[1]);
    const offset = match[2] === undefined ? undefined : Number(match[2]);
    if (offset !== undefined) {
        validateByteRange(offset, length, kind);
    } else if (!Number.isSafeInteger(length) || length <= 0) {
        throw new HLSParseError(`Invalid byte range for ${subject}`);
    }
    return { ...(offset !== undefined ? { offset } : {}), length };
}

function validateByteRange(offset: number, length: number, kind: HLSSegmentKind): void {
    if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(length) ||
        length <= 0 ||
        offset > Number.MAX_SAFE_INTEGER - (length - 1)
    ) {
        throw new HLSParseError(`Invalid byte range for ${SEGMENT_NAMES[kind]}`);
    }
}
