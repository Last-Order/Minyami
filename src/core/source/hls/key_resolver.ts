import { DownloadSourceContext, DownloadSourceHttpClient } from "@/core/source/types";
import { getAbortSignal } from "@/utils/abort";
import logger from "@/utils/log";
import { HLSExplicitKey } from "./explicit_key";
import { HLSKeyReference, HLSKeyReferenceKind, HLSMediaEncryption, HLSMediaPlaylist } from "./playlist/parser";

export interface HLSKeyResolver {
    /** Registers every effective key reference before the corresponding items are published. */
    ensure(
        playlist: HLSMediaPlaylist,
        context: DownloadSourceContext,
        method?: HLSMediaEncryption["method"],
    ): Promise<void>;
}

/**
 * Owns HLS key acquisition independently of container-specific encryption adaptation.
 * One explicit key remains authoritative for every URI; multiple keys are assigned to
 * unique references in one media-playlist cursor's first-seen order and retain that
 * assignment across live refreshes.
 */
export function createHLSKeyResolver(
    explicitKeys: readonly HLSExplicitKey[],
    http: DownloadSourceHttpClient,
): HLSKeyResolver {
    const explicitKeyByReference = new Map<string, string>();
    const seenReferences = new Set<string>();
    let nextExplicitKeyIndex = 0;

    return {
        async ensure(playlist, context, method) {
            const referencedKeys = collectReferencedKeys(playlist, method);
            assignExplicitKeys(referencedKeys);
            const missingKeys = referencedKeys.filter((key) => !context.keys.has(key.id));
            if (missingKeys.length === 0) {
                return;
            }

            if (
                missingKeys.some(
                    (key) => !explicitKeyByReference.has(key.id) && key.kind === HLSKeyReferenceKind.External,
                )
            ) {
                // Reject the whole batch before fetching anything so opaque identities never become network targets.
                throw new Error("An explicit decryption key is required for this HLS key reference.");
            }

            const resolved: Record<string, string> = {};
            for (const [index, key] of missingKeys.entries()) {
                const explicitKey = explicitKeyByReference.get(key.id);
                if (explicitKey !== undefined) {
                    resolved[key.id] = explicitKey;
                    continue;
                }

                logger.info(`Resolving decrypt keys. (${index + 1} / ${missingKeys.length})`);
                try {
                    // The source HTTP facade owns retries; the resolver only converts the final key bytes.
                    const response = await http.request<ArrayBuffer>(
                        key.kind === HLSKeyReferenceKind.Http ? key.url : key.uri,
                        {
                            responseType: "arraybuffer",
                            signal: getAbortSignal(),
                        },
                    );
                    resolved[key.id] = Buffer.from(response.data).toString("hex");
                } catch (error) {
                    logger.debug(error);
                    throw error;
                }
            }
            // Publish the complete resolution batch atomically with respect to source discovery.
            context.keys.setMany(resolved);
        },
    };

    function assignExplicitKeys(references: readonly HLSKeyReference[]): void {
        for (const reference of references) {
            if (seenReferences.has(reference.id)) {
                continue;
            }
            seenReferences.add(reference.id);

            if (explicitKeys.length === 1) {
                explicitKeyByReference.set(reference.id, explicitKeys[0].key);
                continue;
            }
            const explicitKey = explicitKeys[nextExplicitKeyIndex];
            if (explicitKey) {
                explicitKeyByReference.set(reference.id, explicitKey.key);
                nextExplicitKeyIndex++;
            }
        }
    }
}

function collectReferencedKeys(
    playlist: HLSMediaPlaylist,
    method?: HLSMediaEncryption["method"],
): readonly HLSKeyReference[] {
    const referencedKeys = new Map<string, HLSKeyReference>();
    for (const segment of playlist.segments) {
        if (segment.encryption && (method === undefined || segment.encryption.method === method)) {
            referencedKeys.set(segment.encryption.key.id, segment.encryption.key);
        }
    }
    return [...referencedKeys.values()];
}
