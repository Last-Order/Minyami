import logger from "../../../../utils/log";
import { SiteAdapterOptions, SiteAdapterResult } from "./types";

class EncryptionKeyFetchError extends Error {}

export async function adaptCommon({ explicitKeys, http }: SiteAdapterOptions): Promise<SiteAdapterResult> {
    if (explicitKeys.length > 1) {
        throw new Error("The common HLS adapter accepts at most one explicit decryption key.");
    }
    const explicitKey = explicitKeys[0];

    return {
        keyResolver: async ({ keyUrls, signal }) => {
            if (explicitKey !== undefined) {
                // In the common adapter an explicit key is authoritative for every absolute key identity.
                return Object.fromEntries(keyUrls.map((keyUrl) => [keyUrl, explicitKey]));
            }

            const resolved: Record<string, string> = {};
            for (const [index, url] of keyUrls.entries()) {
                logger.info(`Downloading decrypt keys. (${index + 1} / ${keyUrls.length})`);

                try {
                    const response = await http.request<ArrayBuffer>(url, {
                        responseType: "arraybuffer",
                        signal,
                    });
                    resolved[url] = Array.from(new Uint8Array(response.data))
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
