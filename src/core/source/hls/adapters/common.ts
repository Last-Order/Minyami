import logger from "../../../../utils/log";
import { HLSKeyReferenceKind } from "../parser";
import { SiteAdapterOptions, SiteAdapterResult } from "./types";

class EncryptionKeyFetchError extends Error {}

export async function adaptCommon({ explicitKeys, http }: SiteAdapterOptions): Promise<SiteAdapterResult> {
    if (explicitKeys.length > 1) {
        throw new Error("The common HLS adapter accepts at most one explicit decryption key.");
    }
    const explicitKey = explicitKeys[0]?.key;

    return {
        keyResolver: async ({ keys, signal }) => {
            if (explicitKey !== undefined) {
                // In the common adapter an explicit key is authoritative for every absolute key identity.
                return Object.fromEntries(keys.map((key) => [key.id, explicitKey]));
            }
            const resolvableKeys = keys.filter((key) => key.kind !== HLSKeyReferenceKind.External);
            if (resolvableKeys.length !== keys.length) {
                // Reject the whole batch before fetching anything so opaque identities never become network targets.
                throw new Error("An explicit decryption key is required for this HLS key reference.");
            }

            const resolved: Record<string, string> = {};
            for (const [index, key] of resolvableKeys.entries()) {
                logger.info(`Resolving decrypt keys. (${index + 1} / ${resolvableKeys.length})`);

                try {
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
                    throw new EncryptionKeyFetchError("Source request attempts exhausted. Abort.");
                }
            }
            return resolved;
        },
    };
}
