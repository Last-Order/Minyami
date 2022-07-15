import { requestRaw } from "../../utils/media";
import logger from "../../utils/log";
import { buildFullUrl } from "../../utils/common";
import { ParserOptions, ParserResult } from "./types";

class EncryptionKeyFetchError extends Error {}

export default class Parser {
    static async parse({ downloader }: ParserOptions): Promise<ParserResult> {
        downloader.setOnKeyUpdated(async ({ keyUrls, explicitKeys, m3u8Url, saveEncryptionKey }) => {
            const keys = {};
            // collect all key urls
            for (let i = 0; i <= keyUrls.length - 1; i++) {
                keys[buildFullUrl(m3u8Url, keyUrls[i])] = explicitKeys[i] || "";
            }
            // download all keys
            let counter = 1;
            for (const url of Object.keys(keys)) {
                logger.info(`Downloading decrypt keys. (${counter} / ${Object.keys(keys).length})`);
                if (explicitKeys[counter - 1]) {
                    saveEncryptionKey(buildFullUrl(m3u8Url, url), explicitKeys[counter - 1]);
                    continue;
                }
                let retryCounter = downloader.retries;
                while (retryCounter > 0) {
                    try {
                        const response = await requestRaw(url, {
                            responseType: "arraybuffer",
                        });
                        const hexKey = Array.from(new Uint8Array(response.data))
                            .map((i) => (i.toString(16).length === 1 ? "0" + i.toString(16) : i.toString(16)))
                            .join("");
                        saveEncryptionKey(buildFullUrl(m3u8Url, url), hexKey);
                        break;
                    } catch (e) {
                        if (retryCounter > 1) {
                            retryCounter--;
                            logger.debug(e);
                            logger.info("Download decryption key failed, retry.");
                        } else {
                            throw new EncryptionKeyFetchError("Max retries exceeded. Abort.");
                        }
                    }
                }
                counter++;
            }
        });
        return {};
    }
}
