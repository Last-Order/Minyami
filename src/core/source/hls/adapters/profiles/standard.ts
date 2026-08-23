import logger from "../../../../../utils/log";
import { MPEG_TS_CONTAINER } from "../../../../media_container";
import { HLSKeyReferenceKind, HLSSegmentKind } from "../../parser";
import { toDownloadItem } from "./shared";
import { HLSProfileAdapter } from "./types";

const PROFILE_ID = "standard";

export const standardHLSProfile: HLSProfileAdapter = {
    id: PROFILE_ID,
    matches: (playlist) =>
        !playlist.segments.some((segment) => segment.kind === HLSSegmentKind.Initialization) &&
        playlist.segments.every(
            (segment) =>
                segment.encryption === undefined ||
                segment.encryption.method === "AES-128" ||
                segment.encryption.method === "SAMPLE-AES"
        ),
    prepare: ({ playlist, explicitKeys, http }) => {
        if (playlist.segments.some((segment) => segment.encryption?.method === "SAMPLE-AES")) {
            if (explicitKeys.length !== 1) {
                throw new Error("Exactly one explicit decryption key is required for SAMPLE-AES HLS.");
            }
            if (!/^[0-9a-fA-F]{32}$/.test(explicitKeys[0].key)) {
                throw new Error("SAMPLE-AES key must contain exactly 16 bytes of hexadecimal data.");
            }
        }
        if (explicitKeys.length > 1) {
            throw new Error("The standard HLS profile accepts at most one explicit decryption key.");
        }
        const explicitKey = explicitKeys[0]?.key;

        return {
            id: PROFILE_ID,
            container: MPEG_TS_CONTAINER,
            ensureKeys: async (candidate, context, signal) => {
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
            },
            toDownloadItem: (segment) => {
                if (!segment.encryption) {
                    return toDownloadItem(segment);
                }
                if (segment.encryption.method === "SAMPLE-AES") {
                    if (!segment.encryption.iv) {
                        throw new Error("An explicit IV is required for MPEG-TS SAMPLE-AES HLS.");
                    }
                    return toDownloadItem(segment, {
                        scheme: "mpeg-ts-sample-aes",
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
            },
        };
    },
};
