import {
    HLSAudioRendition,
    HLSMasterPlaylist,
    HLSParseError,
    HLSParseOptions,
    HLSPlaylistKind,
    HLSSubtitleRendition,
    HLSVariant,
} from "./models";
import { findNextUri, getTagBody, parseAttributeList, resolvePlaylistUri } from "./syntax";
import { resolvePlaylistVariables } from "./variables";

const STREAM_TAG = "#EXT-X-STREAM-INF";
const MEDIA_TAG = "#EXT-X-MEDIA:";

export function parseMasterPlaylist(options: HLSParseOptions): HLSMasterPlaylist {
    const { playlistUrl = "" } = options;
    const { lines, variables } = resolvePlaylistVariables(options, HLSPlaylistKind.Master);
    const { audioRenditions, subtitleRenditions } = parseRenditions(lines, playlistUrl);
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
    const subtitleGroupIds = new Set(subtitleRenditions.map((rendition) => rendition.groupId));
    for (const variant of variants) {
        if (variant.audioGroupId && !audioGroupIds.has(variant.audioGroupId)) {
            throw new HLSParseError(`Missing audio renditions for group ${variant.audioGroupId}.`);
        }
        if (variant.subtitleGroupId && !subtitleGroupIds.has(variant.subtitleGroupId)) {
            throw new HLSParseError(`Missing subtitle renditions for group ${variant.subtitleGroupId}.`);
        }
    }

    return {
        kind: HLSPlaylistKind.Master,
        variants,
        audioRenditions,
        ...(subtitleRenditions.length ? { subtitleRenditions } : {}),
        ...(variables ? { variables } : {}),
    };
}

function parseRenditions(lines: readonly string[], playlistUrl: string) {
    const audioRenditions: HLSAudioRendition[] = [];
    const subtitleRenditions: HLSSubtitleRendition[] = [];
    for (const line of lines) {
        if (!line.startsWith(MEDIA_TAG)) {
            continue;
        }
        const attributes = parseAttributeList(getTagBody(line));
        const type = attributes["TYPE"];
        if (type !== "AUDIO" && type !== "SUBTITLES") {
            continue;
        }

        const groupId = attributes["GROUP-ID"];
        const name = attributes["NAME"];
        if (!groupId || !name) {
            throw new HLSParseError(
                `Missing GROUP-ID or NAME for HLS ${type === "AUDIO" ? "audio" : "subtitle"} rendition.`,
            );
        }
        const uri = attributes["URI"];
        const rendition = {
            groupId,
            name,
            ...(attributes["LANGUAGE"] ? { language: attributes["LANGUAGE"] } : {}),
            ...(attributes["CHARACTERISTICS"] ? { characteristics: attributes["CHARACTERISTICS"] } : {}),
            isDefault: attributes["DEFAULT"] === "YES",
            autoSelect: attributes["AUTOSELECT"] === "YES",
        };
        if (type === "SUBTITLES") {
            if (!uri) {
                throw new HLSParseError("Missing URI for HLS subtitle rendition.");
            }
            subtitleRenditions.push({
                ...rendition,
                url: resolvePlaylistUri(playlistUrl, uri),
                isForced: attributes["FORCED"] === "YES",
            });
            continue;
        }
        const channels = parseChannelCount(attributes["CHANNELS"]);
        audioRenditions.push({
            ...rendition,
            ...(uri ? { url: resolvePlaylistUri(playlistUrl, uri) } : {}),
            ...(channels !== undefined ? { channels } : {}),
        });
    }
    return { audioRenditions, subtitleRenditions };
}

function createVariant(attributes: Record<string, string>, url: string): HLSVariant {
    const variant: HLSVariant = {
        url,
        bandwidth: +attributes["BANDWIDTH"],
        ...(attributes["CODECS"] ? { codecs: attributes["CODECS"] } : {}),
        ...(attributes["FRAME-RATE"] ? { frameRate: +attributes["FRAME-RATE"] } : {}),
        ...(attributes["AUDIO"] ? { audioGroupId: attributes["AUDIO"] } : {}),
        ...(attributes["SUBTITLES"] ? { subtitleGroupId: attributes["SUBTITLES"] } : {}),
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
