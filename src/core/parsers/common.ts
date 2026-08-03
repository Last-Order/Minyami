import logger from "../../utils/log";
import { buildFullUrl } from "../../utils/common";
import { ParserOptions, ParserResult } from "./types";

class EncryptionKeyFetchError extends Error {}

export async function parseCommon({ http, retries }: ParserOptions): Promise<ParserResult> {
    return {
        keyResolver: async ({ keyUrls, explicitKeys, playlistUrl }) => {
            const resolved: Record<string, string> = {};
            for (let index = 0; index < keyUrls.length; index++) {
                const url = buildFullUrl(playlistUrl, keyUrls[index]);
                logger.info(`Downloading decrypt keys. (${index + 1} / ${keyUrls.length})`);

                if (explicitKeys[index]) {
                    resolved[url] = explicitKeys[index];
                    continue;
                }

                let retriesLeft = retries;
                while (retriesLeft > 0) {
                    try {
                        const response = await http.request<ArrayBuffer>(url, {
                            responseType: "arraybuffer",
                        });
                        resolved[url] = Array.from(new Uint8Array(response.data))
                            .map((value) => value.toString(16).padStart(2, "0"))
                            .join("");
                        break;
                    } catch (error) {
                        retriesLeft--;
                        if (retriesLeft === 0) {
                            throw new EncryptionKeyFetchError("Max retries exceeded. Abort.");
                        }
                        logger.debug(error);
                        logger.info("Download decryption key failed, retry.");
                    }
                }
            }
            return resolved;
        },
    };
}
