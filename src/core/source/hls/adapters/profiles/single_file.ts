import { HLSSegment, HLSSegmentKind } from "@/core/source/hls/playlist/parser";
import { createHLSKeyResolver } from "@/core/source/hls/key_resolver";
import { toDownloadItem } from "./download_item";
import { HLSProfilePlan, HLSProfilePrepareOptions, SAMPLE_AES_EXPLICIT_KEY_REQUIRED } from "./types";

type SingleFileSampleAesScheme = "mpeg-ts-sample-aes" | "packed-aac-sample-aes";

export function prepareSingleFileKeys({ explicitKeys, http }: HLSProfilePrepareOptions): HLSProfilePlan["ensureKeys"] {
    const keyResolver = createHLSKeyResolver(explicitKeys, http);

    return async (candidate, context) => {
        if (candidate.segments.some((segment) => segment.encryption?.method === "SAMPLE-AES")) {
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
        await keyResolver.ensure(candidate, context);
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
    return toDownloadItem(segment, {
        scheme: "aes-128-cbc",
        keyId: segment.encryption.key.id,
        // Resolve HLS's sequence-derived default before crossing the protocol-neutral boundary.
        iv: segment.kind === HLSSegmentKind.Initialization ? iv! : iv || segment.sequenceId.toString(16),
    });
}
