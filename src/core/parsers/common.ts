import { requestRaw } from "../../utils/media";
import CommonUtils from "../../utils/common";
import logger from "../../utils/log";
import { ParserOptions, ParserResult } from "./types";

class StreamParseError extends Error {}

export default class Parser {
    static async parse({ downloader }: ParserOptions): Promise<ParserResult> {
        if (downloader.m3u8.encryptKeys.length > 0) {
            const keys = {};
            const explicitKeys: string[] = typeof downloader.key === "string" ? downloader.key.split(",") : [];
            // collect all key urls
            for (let i = 0; i <= downloader.m3u8.encryptKeys.length - 1; i++) {
                keys[CommonUtils.buildFullUrl(downloader.m3u8.m3u8Url, downloader.m3u8.encryptKeys[i])] =
                    explicitKeys[i] || "";
            }
            // download all keys
            let counter = 1;
            for (const url of Object.keys(keys)) {
                logger.info(`Downloading decrypt keys. (${counter} / ${Object.keys(keys).length})`);
                if (explicitKeys[counter - 1]) {
                    downloader.saveEncryptionKey(
                        CommonUtils.buildFullUrl(downloader.m3u8.m3u8Url, url),
                        explicitKeys[counter - 1]
                    );
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
                        downloader.saveEncryptionKey(CommonUtils.buildFullUrl(downloader.m3u8.m3u8Url, url), hexKey);
                        break;
                    } catch (e) {
                        if (retryCounter > 1) {
                            retryCounter--;
                            logger.debug(e);
                            logger.info("Download decryption key failed, retry.");
                        } else {
                            throw new StreamParseError("Max retries exceeded. Abort.");
                        }
                    }
                }
                counter++;
            }
        }
        return {};
    }
}
