import { buildFullUrl } from "../../../utils/common";
import { HLSParseError } from "./models";

/**
 * Normalize playlist lines once so master and media parsers agree on blank-line and CRLF handling.
 * Empty lines carry no protocol meaning and must not interrupt the tag-to-URI association.
 */
export function getPlaylistLines(content: string): string[] {
    return content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

export function getTagBody(line: string): string {
    const separatorIndex = line.indexOf(":");
    return separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
}

/**
 * Parses an HLS attribute-list without splitting commas or equals signs inside quoted values.
 * HLS quoted strings cannot contain a quote, so a small scanner is clearer and cheaper than a broad regex.
 */
export function parseAttributeList(body: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    let cursor = 0;

    while (cursor < body.length) {
        const keyStart = cursor;
        while (cursor < body.length && body[cursor] !== "=" && body[cursor] !== ",") {
            cursor++;
        }
        const key = body.slice(keyStart, cursor);
        let value = "";

        if (body[cursor] === "=") {
            cursor++;
            if (body[cursor] === '"') {
                cursor++;
                const valueStart = cursor;
                while (cursor < body.length && body[cursor] !== '"') {
                    cursor++;
                }
                value = body.slice(valueStart, cursor);
                if (body[cursor] === '"') {
                    cursor++;
                }
            } else {
                const valueStart = cursor;
                while (cursor < body.length && body[cursor] !== ",") {
                    cursor++;
                }
                value = body.slice(valueStart, cursor);
            }
        }

        if (key) {
            attributes[key] = value;
        }
        while (cursor < body.length && body[cursor] !== ",") {
            cursor++;
        }
        if (body[cursor] === ",") {
            cursor++;
        }
    }

    return attributes;
}

export function resolvePlaylistUri(playlistUrl: string, uri: string): string {
    if (!uri.startsWith("http") && !playlistUrl) {
        throw new HLSParseError("Missing base URL for HLS playlist.");
    }
    return buildFullUrl(playlistUrl, uri);
}

/**
 * Segment metadata tags may appear between EXTINF and its URI. The URI lookup deliberately ignores only
 * tag lines, preserving the manifest order used when encryption state and sequence ids are assigned.
 */
export function findNextUri(lines: string[], startIndex: number): string | undefined {
    for (let index = startIndex; index < lines.length; index++) {
        if (lines[index] && !lines[index].startsWith("#")) {
            return lines[index];
        }
    }
    return undefined;
}
