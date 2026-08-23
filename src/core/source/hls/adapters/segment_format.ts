import { hasAdtsHeader, parseLeadingId3Tags } from "../../../packed_audio";
import { DownloadSourceHttpClient } from "../../types";
import { HLSMediaPlaylist, HLSSegmentKind } from "../parser";

const PROBE_BYTE_COUNT = 16 * 1024;

export type HLSMediaSegmentFormat = "iso-bmff" | "mpeg-ts" | "packed-aac";

/** Resolves the media envelope once so every later item carries a complete decryption descriptor. */
export async function detectHLSMediaSegmentFormat(
    playlist: HLSMediaPlaylist,
    http: DownloadSourceHttpClient,
    signal: AbortSignal
): Promise<HLSMediaSegmentFormat> {
    if (playlist.segments.some((segment) => segment.kind === HLSSegmentKind.Initialization)) {
        return "iso-bmff";
    }

    const firstMedia = playlist.segments.find((segment) => segment.kind === HLSSegmentKind.Media);
    if (!firstMedia) {
        // Preserve the historical default for an empty standard playlist.
        return "mpeg-ts";
    }
    const extension = new URL(firstMedia.url).pathname.split(".").at(-1)?.toLowerCase();
    if (extension === "aac") {
        return "packed-aac";
    }
    if (extension === "ts" || extension === "m2ts") {
        return "mpeg-ts";
    }

    // Unknown locators need content evidence only for SAMPLE-AES, where choosing the wrong envelope is fatal.
    if (firstMedia.encryption?.method !== "SAMPLE-AES") {
        return "mpeg-ts";
    }
    const prefix = await probeSegmentPrefix(firstMedia, http, signal);
    if (isMpegTransportStream(prefix)) {
        return "mpeg-ts";
    }
    try {
        const { payloadOffset } = parseLeadingId3Tags(prefix);
        if (hasAdtsHeader(prefix, payloadOffset)) {
            return "packed-aac";
        }
    } catch {
        // The shared error below names the profile-selection failure instead of one rejected candidate parser.
    }
    throw new Error("Unable to determine the SAMPLE-AES HLS media segment format.");
}

async function probeSegmentPrefix(
    segment: Extract<HLSMediaPlaylist["segments"][number], { readonly kind: HLSSegmentKind.Media }>,
    http: DownloadSourceHttpClient,
    signal: AbortSignal
): Promise<Buffer> {
    const offset = segment.byteRange?.offset ?? 0;
    const length = Math.min(segment.byteRange?.length ?? PROBE_BYTE_COUNT, PROBE_BYTE_COUNT);
    const response = await http.request<ArrayBuffer>(segment.url, {
        responseType: "arraybuffer",
        headers: {
            Range: `bytes=${offset}-${offset + length - 1}`,
            "Accept-Encoding": "identity",
        },
        signal,
    });
    const body = Buffer.from(response.data);
    const rangedBody = response.status === 206 || offset === 0 ? body : body.subarray(offset);
    return rangedBody.subarray(0, length);
}

function isMpegTransportStream(data: Buffer): boolean {
    if (data.length < 188 || data[0] !== 0x47) {
        return false;
    }
    const packetCount = Math.min(3, Math.floor(data.length / 188));
    for (let packet = 1; packet < packetCount; packet++) {
        if (data[packet * 188] !== 0x47) {
            return false;
        }
    }
    return true;
}
