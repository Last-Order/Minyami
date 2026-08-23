import {
    HLSAudioRendition,
    HLSMasterPlaylist,
    HLSParseError,
    HLSParseOptions,
    HLSPlaylistKind,
    HLSVariant,
} from "./models";
import { findNextUri, getPlaylistLines, getTagBody, parseAttributeList, resolvePlaylistUri } from "./syntax";

const STREAM_TAG = "#EXT-X-STREAM-INF";
const MEDIA_TAG = "#EXT-X-MEDIA:";

export function parseMasterPlaylist({ content, playlistUrl = "" }: HLSParseOptions): HLSMasterPlaylist {
    const lines = getPlaylistLines(content);
    const audioRenditions = parseAudioRenditions(lines, playlistUrl);
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
            throw new HLSParseError("Missing BANDWIDTH attribute for streams.");
        }
        variants.push(createVariant(attributes, resolvePlaylistUri(playlistUrl, uri)));
    }

    const audioGroupIds = new Set(audioRenditions.map((rendition) => rendition.groupId));
    for (const variant of variants) {
        if (variant.audioGroupId && !audioGroupIds.has(variant.audioGroupId)) {
            throw new HLSParseError(`Missing audio renditions for group ${variant.audioGroupId}.`);
        }
    }

    return { kind: HLSPlaylistKind.Master, variants, audioRenditions };
}

function parseAudioRenditions(lines: readonly string[], playlistUrl: string): HLSAudioRendition[] {
    const renditions: HLSAudioRendition[] = [];
    for (const line of lines) {
        if (!line.startsWith(MEDIA_TAG)) {
            continue;
        }
        const attributes = parseAttributeList(getTagBody(line));
        if (attributes["TYPE"] !== "AUDIO") {
            continue;
        }

        const groupId = attributes["GROUP-ID"];
        const name = attributes["NAME"];
        if (!groupId || !name) {
            throw new HLSParseError("Missing GROUP-ID or NAME for HLS audio rendition.");
        }
        const uri = attributes["URI"];
        const channels = parseChannelCount(attributes["CHANNELS"]);
        renditions.push({
            groupId,
            name,
            ...(uri ? { url: resolvePlaylistUri(playlistUrl, uri) } : {}),
            ...(attributes["LANGUAGE"] ? { language: attributes["LANGUAGE"] } : {}),
            ...(attributes["CHARACTERISTICS"] ? { characteristics: attributes["CHARACTERISTICS"] } : {}),
            ...(channels !== undefined ? { channels } : {}),
            isDefault: attributes["DEFAULT"] === "YES",
            autoSelect: attributes["AUTOSELECT"] === "YES",
        });
    }
    return renditions;
}

function createVariant(attributes: Record<string, string>, url: string): HLSVariant {
    const variant: HLSVariant = {
        url,
        bandwidth: +attributes["BANDWIDTH"],
        ...(attributes["CODECS"] ? { codecs: attributes["CODECS"] } : {}),
        ...(attributes["FRAME-RATE"] ? { frameRate: +attributes["FRAME-RATE"] } : {}),
        ...(attributes["AUDIO"] ? { audioGroupId: attributes["AUDIO"] } : {}),
    };
    const resolution = attributes["RESOLUTION"];
    if (!resolution || !resolution.includes("x")) {
        return variant;
    }
    const [width, height] = resolution.split("x").map((value) => parseInt(value));
    return { ...variant, resolution: { width, height } };
}

function parseChannelCount(value?: string): number | undefined {
    if (!value) {
        return undefined;
    }
    const channels = parseInt(value.split("/")[0]);
    return Number.isFinite(channels) ? channels : undefined;
}
