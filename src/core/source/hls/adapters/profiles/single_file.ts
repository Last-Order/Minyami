import logger from "../../../../../utils/log";
import { HLSKeyReferenceKind, HLSSegment, HLSSegmentKind } from "../../playlist/parser";
import { toDownloadItem } from "./download_item";
import { HLSProfilePlan, HLSProfilePrepareOptions, SAMPLE_AES_EXPLICIT_KEY_REQUIRED } from "./types";

type SingleFileSampleAesScheme = "mpeg-ts-sample-aes" | "packed-aac-sample-aes";

export function prepareSingleFileKeys(
    { playlist, explicitKeys, http }: HLSProfilePrepareOptions,
    tooManyKeysMessage: string
): HLSProfilePlan["ensureKeys"] {
    if (playlist.segments.some((segment) => segment.encryption?.method === "SAMPLE-AES")) {
        if (explicitKeys.length === 0) {
            throw new Error(SAMPLE_AES_EXPLICIT_KEY_REQUIRED);
        }
        if (explicitKeys.length > 1) {
            throw new Error("Exactly one explicit decryption key is required for SAMPLE-AES HLS.");
        }
        if (!/^[0-9a-fA-F]{32}$/.test(explicitKeys[0].key)) {
            throw new Error("SAMPLE-AES key must contain exactly 16 bytes of hexadecimal data.");
        }
    }
    if (explicitKeys.length > 1) {
        throw new Error(tooManyKeysMessage);
    }
    const explicitKey = explicitKeys[0]?.key;

    return async (candidate, context, signal) => {
        const referencedKeys = new Map(
            candidate.segments.flatMap((segment) =>
                segment.encryption ? [[segment.encryption.key.id, segment.encryption.key] as const] : []
            )
        );
        const missingKeys = [...referencedKeys.values()].filter((key) => !context.keys.has(key.id));
        if (missingKeys.length === 0) {
            return;
        }

        if (explicitKey !== undefined) {
            // One manual key is authoritative for every identity, so no remote key requests are attempted.
            context.keys.setMany(Object.fromEntries(missingKeys.map((key) => [key.id, explicitKey])));
            return;
        }
        if (missingKeys.some((key) => key.kind === HLSKeyReferenceKind.External)) {
            // Opaque license identities such as skd:// are never treated as fetchable network locations.
            throw new Error("An explicit decryption key is required for this HLS key reference.");
        }

        const resolved: Record<string, string> = {};
        for (const [index, key] of missingKeys.entries()) {
            logger.info(`Resolving decrypt keys. (${index + 1} / ${missingKeys.length})`);
            try {
                // The source HTTP facade owns retries; the profile only converts the final key bytes.
                const response = await http.request<ArrayBuffer>(
                    key.kind === HLSKeyReferenceKind.Http ? key.url : key.uri,
                    {
                        responseType: "arraybuffer",
                        signal,
                    }
                );
                resolved[key.id] = Array.from(new Uint8Array(response.data))
                    .map((value) => value.toString(16).padStart(2, "0"))
                    .join("");
            } catch (error) {
                logger.debug(error);
                throw new Error("Source request attempts exhausted. Abort.");
            }
        }
        // Register the complete batch before its corresponding items can be published to workers.
        context.keys.setMany(resolved);
    };
}

export function toSingleFileDownloadItem(
    segment: HLSSegment,
    sampleAesScheme: SingleFileSampleAesScheme,
    missingIvMessage: string
) {
    if (!segment.encryption) {
        return toDownloadItem(segment);
    }
    if (segment.encryption.method === "SAMPLE-AES") {
        if (!segment.encryption.iv) {
            throw new Error(missingIvMessage);
        }
        return toDownloadItem(segment, {
            scheme: sampleAesScheme,
            keyId: segment.encryption.key.id,
            iv: segment.encryption.iv,
        });
    }
    const iv = segment.encryption.iv;
    if (segment.kind === HLSSegmentKind.Initialization && !iv) {
        throw new Error("An explicit IV is required for an encrypted initialization segment.");
    }
    return toDownloadItem(segment, {
        scheme: "aes-128-cbc",
        keyId: segment.encryption.key.id,
        // Resolve HLS's sequence-derived default before crossing the protocol-neutral boundary.
        iv: segment.kind === HLSSegmentKind.Initialization ? iv! : iv || segment.sequenceId.toString(16),
    });
}
