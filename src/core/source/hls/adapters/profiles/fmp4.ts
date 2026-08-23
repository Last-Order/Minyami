import logger from "../../../../../utils/log";
import { inspectIsoBmffInitialization } from "../../../../isobmff";
import { MP4_CONTAINER } from "../../../../media_container";
import { DownloadSourceContext, IsoBmffSampleAesKey } from "../../../types";
import { HLSExplicitKey } from "../../explicit_key";
import {
    HLSByteRange,
    HLSInitializationSegment,
    HLSKeyReferenceKind,
    HLSMediaPlaylist,
    HLSSegment,
    HLSSegmentKind,
} from "../../parser";
import { toDownloadItem } from "./shared";
import { HLSProfileAdapter, HLSProfilePrepareOptions } from "./types";

const PROFILE_ID = "fmp4";
const AES_128_KEY = /^[0-9a-fA-F]{32}$/;
const HEX_KID = /^[0-9a-fA-F]{32}$/;
const UUID_KID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface PreparedExplicitKey {
    readonly kid?: string;
    readonly key: string;
}

interface SampleAesInitializationContext {
    readonly keys: readonly IsoBmffSampleAesKey[];
    readonly fragmentsInfoBase64: string;
}

export const fmp4HLSProfile: HLSProfileAdapter = {
    id: PROFILE_ID,
    matches: (playlist, format) =>
        format === "iso-bmff" && playlist.segments.some((segment) => segment.kind === HLSSegmentKind.Initialization),
    prepare: (options) => prepareFmp4Profile(options),
};

function prepareFmp4Profile({ explicitKeys, http }: HLSProfilePrepareOptions) {
    let preparedSampleAesKeys: readonly PreparedExplicitKey[] | undefined;
    const sampleAesByInitialization = new Map<string, SampleAesInitializationContext>();

    return {
        id: PROFILE_ID,
        container: MP4_CONTAINER,
        ensureKeys: async (playlist: HLSMediaPlaylist, context: DownloadSourceContext, signal: AbortSignal) => {
            const hasAes128 = playlist.segments.some((segment) => segment.encryption?.method === "AES-128");
            const hasSampleAes = playlist.segments.some((segment) => segment.encryption?.method === "SAMPLE-AES");
            if (hasAes128 && hasSampleAes) {
                throw new Error("One fMP4 media playlist cannot mix AES-128 and SAMPLE-AES encryption.");
            }
            if (!hasSampleAes) {
                await ensureAes128Keys(playlist, explicitKeys, context, http, signal);
                return;
            }
            const preparedKeys = (preparedSampleAesKeys ??= prepareExplicitKeys(explicitKeys));
            const protectedInitializationIds = new Set(
                playlist.segments.flatMap((segment) =>
                    segment.encryption?.method !== "SAMPLE-AES"
                        ? []
                        : segment.kind === HLSSegmentKind.Initialization
                        ? [segment.initializationId]
                        : segment.initializationId
                        ? [segment.initializationId]
                        : (() => {
                              throw new Error("fMP4 SAMPLE-AES media requires an initialization segment.");
                          })()
                )
            );
            if (preparedKeys.length === 0) {
                throw new Error("At least one explicit decryption key is required for fMP4 SAMPLE-AES HLS.");
            }

            const initializationSegments = new Map(
                playlist.segments.flatMap((segment) =>
                    segment.kind === HLSSegmentKind.Initialization
                        ? ([[segment.initializationId, segment]] as const)
                        : []
                )
            );
            for (const initializationId of protectedInitializationIds) {
                if (sampleAesByInitialization.has(initializationId)) {
                    continue;
                }
                const initialization = initializationSegments.get(initializationId);
                if (!initialization) {
                    throw new Error("fMP4 SAMPLE-AES media references an unavailable initialization segment.");
                }
                const data = await loadInitializationSegment(initialization, http, signal);
                const info = inspectIsoBmffInitialization(data);
                if (info.protectedTrackIds.length === 0 || info.protectionSchemes.some((scheme) => scheme !== "cbcs")) {
                    throw new Error(
                        "fMP4 SAMPLE-AES requires protected cbcs sample entries in its initialization segment."
                    );
                }
                const keys = registerKeys(preparedKeys, info.protectedTrackIds, initializationId, context);
                sampleAesByInitialization.set(initializationId, {
                    keys,
                    fragmentsInfoBase64: data.toString("base64"),
                });
            }
        },
        toDownloadItem: (segment: HLSSegment) => {
            const sampleAes =
                segment.kind === HLSSegmentKind.Initialization
                    ? sampleAesByInitialization.get(segment.initializationId)
                    : segment.initializationId
                    ? sampleAesByInitialization.get(segment.initializationId)
                    : undefined;
            if (segment.kind === HLSSegmentKind.Initialization && sampleAes) {
                // The init carries protection metadata even though its boxes are not ciphertext.
                return toDownloadItem(segment, {
                    scheme: "iso-bmff-sample-aes",
                    operation: "initialization",
                    keys: sampleAes.keys,
                });
            }
            if (segment.encryption?.method === "SAMPLE-AES") {
                if (!sampleAes) {
                    throw new Error("Missing prepared fMP4 SAMPLE-AES initialization context.");
                }
                return toDownloadItem(segment, {
                    scheme: "iso-bmff-sample-aes",
                    operation: "fragment",
                    keys: sampleAes.keys,
                    fragmentsInfoBase64: sampleAes.fragmentsInfoBase64,
                });
            }
            if (!segment.encryption) {
                return toDownloadItem(segment);
            }
            const iv = segment.encryption.iv;
            if (segment.kind === HLSSegmentKind.Initialization && !iv) {
                throw new Error("An explicit IV is required for an AES-128 encrypted initialization segment.");
            }
            return toDownloadItem(segment, {
                scheme: "aes-128-cbc",
                keyId: segment.encryption.key.id,
                iv: segment.kind === HLSSegmentKind.Initialization ? iv! : iv || segment.sequenceId.toString(16),
            });
        },
    };
}

async function ensureAes128Keys(
    playlist: HLSMediaPlaylist,
    explicitKeys: readonly HLSExplicitKey[],
    context: DownloadSourceContext,
    http: HLSProfilePrepareOptions["http"],
    signal: AbortSignal
): Promise<void> {
    if (explicitKeys.length > 1) {
        throw new Error("The fMP4 HLS profile accepts at most one explicit AES-128 key.");
    }
    const referencedKeys = new Map(
        playlist.segments.flatMap((segment) =>
            segment.encryption?.method === "AES-128"
                ? ([[segment.encryption.key.id, segment.encryption.key]] as const)
                : []
        )
    );
    const missingKeys = [...referencedKeys.values()].filter((key) => !context.keys.has(key.id));
    if (missingKeys.length === 0) {
        return;
    }
    const explicitKey = explicitKeys[0]?.key;
    if (explicitKey !== undefined) {
        context.keys.setMany(Object.fromEntries(missingKeys.map((key) => [key.id, explicitKey])));
        return;
    }
    if (missingKeys.some((key) => key.kind === HLSKeyReferenceKind.External)) {
        throw new Error("An explicit decryption key is required for this HLS key reference.");
    }
    const resolved: Record<string, string> = {};
    for (const [index, key] of missingKeys.entries()) {
        logger.info(`Resolving decrypt keys. (${index + 1} / ${missingKeys.length})`);
        const response = await http.request<ArrayBuffer>(key.kind === HLSKeyReferenceKind.Http ? key.url : key.uri, {
            responseType: "arraybuffer",
            signal,
        });
        resolved[key.id] = Buffer.from(response.data).toString("hex");
    }
    context.keys.setMany(resolved);
}

function prepareExplicitKeys(explicitKeys: readonly HLSExplicitKey[]): readonly PreparedExplicitKey[] {
    if (explicitKeys.length > 1 && explicitKeys.some((key) => key.kid === undefined)) {
        throw new Error("Multiple fMP4 SAMPLE-AES keys must each include a KID.");
    }
    const kids = new Set<string>();
    return explicitKeys.map((explicitKey) => {
        if (!AES_128_KEY.test(explicitKey.key)) {
            throw new Error("SAMPLE-AES key must contain exactly 16 bytes of hexadecimal data.");
        }
        if (explicitKey.kid === undefined) {
            return { key: explicitKey.key.toLowerCase() };
        }
        const kid = normalizeKid(explicitKey.kid);
        if (kids.has(kid)) {
            throw new Error(`Duplicate fMP4 SAMPLE-AES KID: ${kid}`);
        }
        kids.add(kid);
        return { kid, key: explicitKey.key.toLowerCase() };
    });
}

function normalizeKid(kid: string): string {
    if (!HEX_KID.test(kid) && !UUID_KID.test(kid)) {
        throw new Error("fMP4 SAMPLE-AES KID must contain exactly 16 bytes of hexadecimal data.");
    }
    return kid.replaceAll("-", "").toLowerCase();
}

function registerKeys(
    explicitKeys: readonly PreparedExplicitKey[],
    trackIds: readonly number[],
    initializationId: string,
    context: DownloadSourceContext
): readonly IsoBmffSampleAesKey[] {
    if (explicitKeys.length === 1 && explicitKeys[0].kid === undefined) {
        const keyId = `fmp4:${initializationId}`;
        setConsistentKey(context, keyId, explicitKeys[0].key);
        return trackIds.map((trackId) => ({ selector: String(trackId), keyId }));
    }
    return explicitKeys.map((explicitKey): IsoBmffSampleAesKey => {
        const kid = explicitKey.kid!;
        const keyId = `cenc:kid:${kid}`;
        setConsistentKey(context, keyId, explicitKey.key);
        return { selector: kid, keyId };
    });
}

function setConsistentKey(context: DownloadSourceContext, keyId: string, key: string): void {
    const existing = context.keys.get(keyId);
    if (existing !== undefined && existing.toLowerCase() !== key.toLowerCase()) {
        throw new Error(`Conflicting explicit decryption keys for ${keyId}.`);
    }
    context.keys.set(keyId, key);
}

async function loadInitializationSegment(
    segment: HLSInitializationSegment,
    http: HLSProfilePrepareOptions["http"],
    signal: AbortSignal
): Promise<Buffer> {
    const response = await http.request<ArrayBuffer>(segment.url, {
        responseType: "arraybuffer",
        signal,
        ...(segment.byteRange
            ? { headers: { Range: `bytes=${segment.byteRange.offset}-${rangeEnd(segment.byteRange)}` } }
            : {}),
    });
    const data = Buffer.from(response.data);
    if (!segment.byteRange || data.length === segment.byteRange.length) {
        return data;
    }
    const end = segment.byteRange.offset + segment.byteRange.length;
    if (data.length >= end) {
        return data.subarray(segment.byteRange.offset, end);
    }
    throw new Error("Initialization-segment byte range response has an unexpected length.");
}

function rangeEnd(byteRange: HLSByteRange): number {
    return byteRange.offset + byteRange.length - 1;
}
