import { HLSParseError, HLSParseOptions, HLSPlaylistKind } from "./models";
import { getPlaylistLines, getTagBody, parseAttributeList } from "./syntax";

const DEFINE_TAG = "#EXT-X-DEFINE";
// HLS 2nd Edition draft (rfc8216bis-22) section 6.3.1 requires unknown tags and attributes to be ignored.
// Keep unsupported metadata opaque so its references do not affect the supported attributes.
// https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis-22#section-6.3.1
const VARIABLE_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
    [DEFINE_TAG]: new Set(["NAME", "VALUE", "IMPORT", "QUERYPARAM"]),
    "#EXT-X-STREAM-INF": new Set(["CODECS", "AUDIO"]),
    "#EXT-X-MEDIA": new Set(["GROUP-ID", "NAME", "LANGUAGE", "CHARACTERISTICS", "URI", "CHANNELS"]),
    "#EXT-X-KEY": new Set(["URI", "IV", "KEYFORMAT"]),
    "#EXT-X-MAP": new Set(["URI", "BYTERANGE"]),
};

/**
 * Resolve references in manifest order, before URL resolution can encode their braces as a relative path.
 * HLS 2nd Edition draft (rfc8216bis-22) section 4.4.2.3 makes declarations local to each playlist reload,
 * so every call starts a fresh scope; only explicit IMPORT declarations can read the parent master snapshot.
 * https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis-22#section-4.4.2.3
 */
export function resolvePlaylistVariables(options: HLSParseOptions, kind: HLSPlaylistKind) {
    const variables = new Map<string, string>();
    // Sections 4.3 and 6.3.1 define {$name} references, require declarations before use, and prohibit
    // recursively expanding replacement values. Missing declarations therefore fail at the reference site.
    // https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis-22#section-4.3
    // https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis-22#section-6.3.1
    const substitute = (value: string): string =>
        value.replace(/\{\$([a-zA-Z0-9_-]+)\}/g, (_, name: string) => {
            const replacement = variables.get(name);
            if (replacement === undefined) {
                throw new HLSParseError(`Undefined HLS variable: ${name}.`);
            }
            return replacement;
        });

    const lines = getPlaylistLines(options.content).map((line) => {
        if (!line.startsWith("#")) {
            return substitute(line);
        }
        const separator = line.indexOf(":");
        const tag = separator === -1 ? line : line.slice(0, separator);
        const supportedAttributes = VARIABLE_ATTRIBUTES[tag];
        if (!supportedAttributes) {
            return line;
        }

        // Section 4.3 limits substitution to URI lines, quoted strings, and hexadecimal sequences (here, IV).
        // Decimal and enumerated fields must retain their original syntax.
        // https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis-22#section-4.3
        const body = getTagBody(line).replace(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g, (attribute, name, value: string) => {
            if (!supportedAttributes.has(name)) {
                return attribute;
            }
            if (value.startsWith('"')) {
                return `${name}="${substitute(value.slice(1, -1))}"`;
            }
            return name === "IV" ? `${name}=${substitute(value)}` : attribute;
        });
        if (tag !== DEFINE_TAG) {
            return `${tag}:${body}`;
        }

        const attributes = parseAttributeList(body);
        // Section 4.4.2.3 requires one declaration form, restricts names to [a-zA-Z0-9_-], and forbids
        // duplicate names within a playlist. Names remain case-sensitive and NAME requires a VALUE.
        // https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis-22#section-4.4.2.3
        const selectors = ["NAME", "IMPORT", "QUERYPARAM"].filter((name) => Object.hasOwn(attributes, name));
        if (selectors.length !== 1) {
            throw new HLSParseError("EXT-X-DEFINE requires exactly one of NAME, IMPORT, or QUERYPARAM.");
        }
        const selector = selectors[0];
        const name = attributes[selector];
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
            throw new HLSParseError("Invalid HLS variable name.");
        }
        if (variables.has(name)) {
            throw new HLSParseError(`Duplicate HLS variable: ${name}.`);
        }

        let value: string;
        if (selector === "NAME") {
            if (!Object.hasOwn(attributes, "VALUE")) {
                throw new HLSParseError(`Missing VALUE for HLS variable: ${name}.`);
            }
            value = attributes["VALUE"];
        } else if (selector === "IMPORT") {
            // Section 4.4.2.3 allows IMPORT only in media playlists and requires a matching master variable;
            // merely supplying a parent scope must not implicitly expose its other variables.
            // https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis-22#section-4.4.2.3
            if (kind === HLSPlaylistKind.Master) {
                throw new HLSParseError("HLS variable IMPORT is only allowed in media playlists.");
            }
            if (!options.parentVariables || !Object.hasOwn(options.parentVariables, name)) {
                throw new HLSParseError(`Missing parent HLS variable: ${name}.`);
            }
            value = options.parentVariables[name];
        } else {
            value = queryParameterValue(options.playlistUrl, name);
        }
        variables.set(name, value);
        return line;
    });

    return {
        lines,
        variables: variables.size > 0 ? Object.freeze(Object.fromEntries(variables)) : undefined,
    };
}

/**
 * Section 4.4.2.3 takes QUERYPARAM values from the final playlist URI and requires percent decoding;
 * an absent parameter or one without an associated value is a parse error.
 * https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis-22#section-4.4.2.3
 */
function queryParameterValue(playlistUrl: string | undefined, name: string): string {
    if (playlistUrl && URL.canParse(playlistUrl)) {
        const query = new URL(playlistUrl).search.slice(1);
        for (const parameter of query.split("&")) {
            const separator = parameter.indexOf("=");
            const rawName = separator === -1 ? parameter : parameter.slice(0, separator);
            let decodedName: string;
            try {
                decodedName = decodeURIComponent(rawName);
            } catch {
                continue;
            }
            if (decodedName !== name || separator === -1) {
                continue;
            }
            let value: string;
            try {
                // HLS requires percent decoding, not form decoding: a literal '+' must stay intact.
                value = decodeURIComponent(parameter.slice(separator + 1));
            } catch {
                throw new HLSParseError(`Invalid query parameter for HLS variable: ${name}.`);
            }
            // Sections 4.4.2.3 and 4.2 forbid decoded query values containing quote, CR, or LF because
            // the resulting value must be safe inside an HLS quoted string.
            // https://datatracker.ietf.org/doc/html/draft-pantos-hls-rfc8216bis-22#section-4.2
            if (/["\r\n]/.test(value)) {
                throw new HLSParseError(`Invalid query parameter for HLS variable: ${name}.`);
            }
            return value;
        }
    }
    throw new HLSParseError(`Missing query parameter for HLS variable: ${name}.`);
}
