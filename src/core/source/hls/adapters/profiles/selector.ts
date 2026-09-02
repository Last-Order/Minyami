import { hasAdtsHeader, parseLeadingId3Tags } from "@/core/packed_audio";
import {
    HLSInitializationSegment,
    HLSMediaPlaylist,
    HLSMediaSegment,
    HLSSegment,
    HLSSegmentKind,
} from "@/core/source/hls/playlist/parser";
import { DownloadSourceHttpClient } from "@/core/source/types";
import { getAbortSignal } from "@/utils/abort";
import { fmp4HLSProfile } from "./fmp4";
import { mpegTsHLSProfile } from "./mpeg_ts";
import { packedAacHLSProfile } from "./packed_aac";
import { HLSProfileAdapter } from "./types";

const PROBE_BYTE_COUNT = 16 * 1024;
// ITU-T H.222.0 section 2.4.3 fixes Transport Stream packets at 188 bytes and sync_byte at 0x47.
// https://www.itu.int/rec/T-REC-H.222.0/en
const TS_PACKET_SIZE = 188;
const TS_SYNC_BYTE = 0x47;

type HLSProfileKind = "fmp4" | "mpeg-ts" | "packed-aac";

interface IsoBmffBoxHeader {
    readonly type: string;
    readonly payloadStart: number;
    readonly end: number;
}

/** Analyzes one effective media playlist and selects its profile exactly once. */
export async function selectHLSProfile(
    playlist: HLSMediaPlaylist,
    http: DownloadSourceHttpClient,
): Promise<HLSProfileAdapter> {
    // Partition the immutable snapshot once so every later decision evaluates locator and content evidence against
    // the same playlist shape.
    const initializations = playlist.segments.filter(
        (segment): segment is HLSInitializationSegment => segment.kind === HLSSegmentKind.Initialization,
    );
    const media = playlist.segments.filter(
        (segment): segment is HLSMediaSegment => segment.kind === HLSSegmentKind.Media,
    );
    if (initializations.length === 0) {
        // Preserve the cheap historical path when there is no MAP. Only opaque SAMPLE-AES media needs probing,
        // because its container framing remains visible and therefore provides usable secondary evidence.
        const firstMedia = media[0];
        if (!firstMedia) {
            // Preserve the historical MPEG-TS default for an empty playlist.
            return mpegTsHLSProfile;
        }
        const locatorHint = profileHintFromUrl(firstMedia.url);
        if (locatorHint === "fmp4") {
            return rejectUnmappedFmp4();
        }
        if (locatorHint) {
            return profileForKind(locatorHint);
        }

        // RFC 8216 section 4.3.2.4 defines AES-128 as whole-segment encryption, so its ciphertext has no container
        // signature to probe. The MPEG-TS fallback for other opaque, non-SAMPLE-AES locators is historical behavior.
        // https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.2.4
        if (firstMedia.encryption?.method !== "SAMPLE-AES") {
            return mpegTsHLSProfile;
        }
        // RFC 8216 section 4.3.2.4 defines SAMPLE-AES as encrypting sample data only, leaving container framing
        // available for this bounded format probe.
        // https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.2.4
        const prefix = await probeSegmentPrefix(firstMedia, http);
        const profile = classifyMedia(prefix);
        if (!profile) {
            throw new Error("Unable to determine the SAMPLE-AES HLS media segment format.");
        }
        if (profile === "fmp4") {
            return rejectUnmappedFmp4();
        }
        return profileForKind(profile);
    }

    // A recognized suffix is cheap evidence, but all recognized locators in one cursor must agree before it can
    // bypass network probing. This keeps segment order from changing the selected profile.
    const locatorHints = new Set(
        playlist.segments.flatMap((segment) => {
            const hint = profileHintFromUrl(segment.url);
            return hint ? [hint] : [];
        }),
    );
    if (locatorHints.size > 1) {
        throw new Error("HLS playlist locators indicate conflicting media profiles.");
    }
    const locatorHint = [...locatorHints][0];
    if (locatorHint) {
        return validateProfileShape(locatorHint, initializations, media);
    }

    // RFC 8216 sections 3.1-3.4 make EXT-X-MAP format-neutral: MPEG-TS and fMP4 both have initialization
    // sections, while Packed Audio does not.
    // https://www.rfc-editor.org/rfc/rfc8216.html#section-3.1
    // Prefer the initialization referenced by the first media segment so an unused or stale MAP cannot select the
    // profile. The fallback also permits an initialization-only snapshot to be diagnosed from its content.
    const initializationId = media[0]?.initializationId;
    const initialization =
        initializations.find((segment) => segment.initializationId === initializationId) ?? initializations[0];
    // RFC 8216 section 3.1 forbids sample data in initialization sections, while section 4.3.2.4 defines
    // SAMPLE-AES as sample-only encryption and AES-128 as whole-section encryption. Only AES-128 hides the signature.
    // https://www.rfc-editor.org/rfc/rfc8216.html#section-3.1
    // https://www.rfc-editor.org/rfc/rfc8216.html#section-4.3.2.4
    if (initialization.encryption?.method !== "AES-128") {
        const prefix = await probeSegmentPrefix(initialization, http);
        // RFC 8216 section 3.3 requires an iso6-compatible ftyp followed by moov in the fMP4 initialization.
        // https://www.rfc-editor.org/rfc/rfc8216.html#section-3.3
        // The bounded prefix only needs the complete ftyp box and the following moov header; the moov payload may
        // extend beyond the probe because its contents are not profile-selection evidence.
        const fileType = readIsoBmffBoxHeader(prefix, 0);
        const brands: string[] = [];
        if (fileType?.type === "ftyp" && fileType.end <= prefix.length && fileType.payloadStart + 8 <= fileType.end) {
            brands.push(prefix.toString("latin1", fileType.payloadStart, fileType.payloadStart + 4));
            for (let offset = fileType.payloadStart + 8; offset + 4 <= fileType.end; offset += 4) {
                brands.push(prefix.toString("latin1", offset, offset + 4));
            }
        }
        const movie = fileType ? readIsoBmffBoxHeader(prefix, fileType.end) : undefined;
        const isoBmffInitialization = brands.some((brand) => /^iso[6-9A-Za-z]$/.test(brand)) && movie?.type === "moov";

        // RFC 8216 section 3.2 defines the MPEG-TS Media Initialization Section as PAT followed by PMT.
        // https://www.rfc-editor.org/rfc/rfc8216.html#section-3.2
        // ITU-T H.222.0 sections 2.4.3-2.4.4 define the packet, PID, pointer_field, PAT, and PMT fields parsed below.
        // https://www.itu.int/rec/T-REC-H.222.0/en
        const transportStream = isMpegTransportStream(prefix);
        let mpegTsInitialization = false;
        if (transportStream) {
            // PAT must be PID 0/table 0. Its first non-network program identifies the only PMT PID accepted below,
            // preventing aligned sync bytes alone from being treated as a valid MPEG-TS initialization section.
            const pat = readPsiSection(prefix.subarray(0, TS_PACKET_SIZE));
            if (pat?.pid === 0 && pat.data[0] === 0x00 && pat.data.length >= 12) {
                let programMapPid: number | undefined;
                for (let offset = 8; offset + 4 <= pat.data.length - 4; offset += 4) {
                    if (pat.data.readUInt16BE(offset) !== 0) {
                        programMapPid = ((pat.data[offset + 2] & 0x1f) << 8) | pat.data[offset + 3];
                        break;
                    }
                }
                if (programMapPid !== undefined) {
                    // A Media Initialization Section starts with PAT then PMT, so only the first few complete
                    // packets are relevant to this bounded selector probe.
                    const packetCount = Math.min(4, Math.floor(prefix.length / TS_PACKET_SIZE));
                    for (let packet = 1; packet < packetCount; packet++) {
                        const pmt = readPsiSection(
                            prefix.subarray(packet * TS_PACKET_SIZE, (packet + 1) * TS_PACKET_SIZE),
                        );
                        if (pmt?.pid === programMapPid && pmt.data[0] === 0x02 && pmt.data.length >= 16) {
                            mpegTsInitialization = true;
                            break;
                        }
                    }
                }
            }
        }

        // Complete normative signatures outrank generic container resemblance. A TS-framed or ftyp-prefixed but
        // invalid MAP gets a format-specific error instead of silently falling through to another profile.
        let profile: HLSProfileKind;
        if (isoBmffInitialization) {
            profile = "fmp4";
        } else if (mpegTsInitialization) {
            profile = "mpeg-ts";
        } else if (transportStream) {
            throw new Error("An MPEG-TS EXT-X-MAP initialization section must contain a PAT followed by a PMT.");
        } else {
            if (fileType?.type === "ftyp") {
                throw new Error("An fMP4 EXT-X-MAP must contain an iso6-compatible ftyp box followed by a moov box.");
            }
            throw new Error("Unable to determine the HLS media profile from the EXT-X-MAP initialization section.");
        }
        return validateProfileShape(profile, initializations, media);
    }

    // Whole-section AES-128 can hide the MAP signature. A media segment whose framing remains visible is the only
    // safe secondary evidence; validateProfileShape still enforces the selected format's MAP requirements.
    const probeableMedia = media.find((segment) => segment.encryption?.method !== "AES-128");
    if (probeableMedia) {
        const prefix = await probeSegmentPrefix(probeableMedia, http);
        const profile = classifyMedia(prefix);
        if (profile) {
            return validateProfileShape(profile, initializations, media);
        }
    }
    throw new Error(
        "Unable to determine the HLS media profile: the initialization and media signatures are unavailable.",
    );
}

function validateProfileShape(
    profile: HLSProfileKind,
    initializations: readonly HLSInitializationSegment[],
    media: readonly HLSMediaSegment[],
): HLSProfileAdapter {
    if (profile === "packed-aac") {
        // RFC 8216 section 3.4 defines Packed Audio as having no Media Initialization Section.
        // https://www.rfc-editor.org/rfc/rfc8216.html#section-3.4
        throw new Error("Packed Audio HLS must not contain an EXT-X-MAP initialization segment.");
    }
    if (profile === "fmp4" && media.some((segment) => segment.initializationId === undefined)) {
        // RFC 8216 section 3.3 requires every fMP4 Media Segment in a Media Playlist to have EXT-X-MAP applied.
        // https://www.rfc-editor.org/rfc/rfc8216.html#section-3.3
        throw new Error("Every fMP4 HLS media segment must have an EXT-X-MAP initialization segment.");
    }
    return profileForKind(profile);
}

function rejectUnmappedFmp4(): never {
    // RFC 8216 section 3.3 requires every fMP4 Media Segment in a Media Playlist to have EXT-X-MAP applied.
    // https://www.rfc-editor.org/rfc/rfc8216.html#section-3.3
    throw new Error("fMP4 HLS media requires an EXT-X-MAP initialization segment.");
}

function profileForKind(profile: HLSProfileKind): HLSProfileAdapter {
    switch (profile) {
        case "fmp4":
            return fmp4HLSProfile;
        case "packed-aac":
            return packedAacHLSProfile;
        case "mpeg-ts":
            return mpegTsHLSProfile;
    }
}

function profileHintFromUrl(url: string): HLSProfileKind | undefined {
    // File extensions are non-normative locator hints; normative playlist-shape checks still run after selection.
    const pathname = new URL(url).pathname;
    const extension = pathname.slice(pathname.lastIndexOf(".") + 1).toLowerCase();
    switch (extension) {
        case "ts":
        case "m2ts":
            return "mpeg-ts";
        case "aac":
            return "packed-aac";
        case "mp4":
        case "m4a":
        case "m4s":
        case "cmfa":
        case "cmfv":
            return "fmp4";
        default:
            return undefined;
    }
}

function classifyMedia(data: Buffer): HLSProfileKind | undefined {
    if (isMpegTransportStream(data)) {
        return "mpeg-ts";
    }
    // RFC 8216 section 3.3 defines an fMP4 fragment around a Movie Fragment Box (moof) and Media Data Box.
    // https://www.rfc-editor.org/rfc/rfc8216.html#section-3.3
    // A fragment may have leading styp/sidx/emsg boxes. Skip only complete top-level boxes; an incomplete non-moof
    // box ends inspection because its successor lies outside the bytes actually observed.
    let offset = 0;
    for (let boxIndex = 0; boxIndex < 8; boxIndex++) {
        const box = readIsoBmffBoxHeader(data, offset);
        if (!box) {
            break;
        }
        if (box.type === "moof") {
            return "fmp4";
        }
        if (box.end <= offset || box.end > data.length) {
            break;
        }
        offset = box.end;
    }
    // RFC 8216 section 3.4 defines Packed Audio as leading ID3 timestamp metadata, with AAC carried in ADTS
    // framing. These outer signatures identify the profile without claiming to validate the complete ID3 metadata.
    // https://www.rfc-editor.org/rfc/rfc8216.html#section-3.4
    try {
        const { payloadOffset } = parseLeadingId3Tags(data);
        if (payloadOffset > 0 && hasAdtsHeader(data, payloadOffset)) {
            return "packed-aac";
        }
    } catch {
        // A malformed Packed Audio candidate is not evidence for any supported profile.
    }
    return undefined;
}

async function probeSegmentPrefix(segment: HLSSegment, http: DownloadSourceHttpClient): Promise<Buffer> {
    const offset = segment.byteRange?.offset ?? 0;
    // Bound both bandwidth and parsing work, while never reading beyond an explicit segment byte range.
    const length = Math.min(segment.byteRange?.length ?? PROBE_BYTE_COUNT, PROBE_BYTE_COUNT);
    const response = await http.request<ArrayBuffer>(segment.url, {
        responseType: "arraybuffer",
        headers: {
            Range: `bytes=${offset}-${offset + length - 1}`,
            "Accept-Encoding": "identity",
        },
        signal: getAbortSignal(),
    });
    const body = Buffer.from(response.data);
    // A 206 body already starts at the requested offset. If the origin ignored Range and returned the full resource,
    // apply the absolute byte-range offset locally before enforcing the probe length.
    const rangedBody = response.status === 206 || offset === 0 ? body : body.subarray(offset);
    return rangedBody.subarray(0, length);
}

function readIsoBmffBoxHeader(data: Buffer, offset: number): IsoBmffBoxHeader | undefined {
    // ISO/IEC 14496-12 defines the size/type box header and its 64-bit largesize form used by this bounded parser.
    // https://www.iso.org/standard/83102.html
    if (offset < 0 || offset + 8 > data.length) {
        return undefined;
    }
    const size32 = data.readUInt32BE(offset);
    const type = data.toString("latin1", offset + 4, offset + 8);
    let headerSize = 8;
    let size: number;
    if (size32 === 0) {
        // A zero size extends to the containing data; for this prefix parser, the observed probe is that boundary.
        size = data.length - offset;
    } else if (size32 === 1) {
        if (offset + 16 > data.length) {
            return undefined;
        }
        const largeSize = data.readBigUInt64BE(offset + 8);
        if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) {
            return undefined;
        }
        size = Number(largeSize);
        headerSize = 16;
    } else {
        size = size32;
    }
    if (size < headerSize) {
        return undefined;
    }
    // Returning a header whose declared payload exceeds the bounded probe is intentional: callers can identify a
    // moov/moof box from its complete header without downloading its entire payload.
    return { type, payloadStart: offset + headerSize, end: offset + size };
}

function isMpegTransportStream(data: Buffer): boolean {
    // A single 0x47 byte is weak evidence. Require at least two aligned packets and confirm up to three to keep the
    // bounded probe resistant to accidental matches in arbitrary or encrypted bytes.
    const packetCount = Math.floor(data.length / TS_PACKET_SIZE);
    if (packetCount < 2) {
        return false;
    }
    for (let packet = 0; packet < Math.min(3, packetCount); packet++) {
        if (data[packet * TS_PACKET_SIZE] !== TS_SYNC_BYTE) {
            return false;
        }
    }
    return true;
}

function readPsiSection(packet: Buffer): { readonly pid: number; readonly data: Buffer } | undefined {
    // The selector needs a PSI section that starts in this packet, so reject transport errors and packets without
    // payload_unit_start_indicator instead of attempting cross-packet reassembly here.
    if (
        packet.length !== TS_PACKET_SIZE ||
        packet[0] !== TS_SYNC_BYTE ||
        (packet[1] & 0x80) !== 0 ||
        (packet[1] & 0x40) === 0
    ) {
        return undefined;
    }
    const adaptationControl = (packet[3] >> 4) & 3;
    if (adaptationControl !== 1 && adaptationControl !== 3) {
        return undefined;
    }
    // The adaptation field shifts the payload; pointer_field then locates the first PSI section in that payload.
    const payloadOffset = adaptationControl === 3 ? 5 + packet[4] : 4;
    if (payloadOffset >= packet.length) {
        return undefined;
    }
    const sectionOffset = payloadOffset + 1 + packet[payloadOffset];
    if (sectionOffset + 3 > packet.length) {
        return undefined;
    }
    const sectionLength = ((packet[sectionOffset + 1] & 0x0f) << 8) | packet[sectionOffset + 2];
    const sectionEnd = sectionOffset + 3 + sectionLength;
    // An incomplete cross-packet PSI section is not positive selector evidence. The probe stays conservative rather
    // than classifying a MAP from a partial PAT or PMT.
    if (sectionLength < 4 || sectionEnd > packet.length) {
        return undefined;
    }
    return {
        pid: ((packet[1] & 0x1f) << 8) | packet[2],
        data: packet.subarray(sectionOffset, sectionEnd),
    };
}
