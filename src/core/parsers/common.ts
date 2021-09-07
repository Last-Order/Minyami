import { AxiosRequestConfig } from "axios";
import { requestRaw } from "../../utils/media";
import CommonUtils from "../../utils/common";
import logger from "../../utils/log";
import { ParserOptions, ParserResult } from "./types";

export default class Parser {
    static parse({ downloader }: ParserOptions): Promise<ParserResult> {
        return new Promise(async (resolve, reject) => {
            if (downloader.m3u8.encryptKeys.length > 0) {
                const keys = {};
                // collect all key urls
                for (const key of downloader.m3u8.encryptKeys) {
                    keys[CommonUtils.buildFullUrl(downloader.m3u8.m3u8Url, key)] = downloader.key || "";
                }
                // download all keys
                let counter = 1;
                for (const url of Object.keys(keys)) {
                    logger.info(`Downloading decrypt keys. (${counter} / ${Object.keys(keys).length})`);
                    if (downloader.key) {
                        downloader.saveEncryptionKey(
                            CommonUtils.buildFullUrl(downloader.m3u8.m3u8Url, url),
                            downloader.key
                        );
                        continue;
                    }
                    const response = await requestRaw(url, {
                        responseType: "arraybuffer",
                    });
                    const hexKey = Array.from(new Uint8Array(response.data))
                        .map((i) => (i.toString(16).length === 1 ? "0" + i.toString(16) : i.toString(16)))
                        .join("");
                    downloader.saveEncryptionKey(CommonUtils.buildFullUrl(downloader.m3u8.m3u8Url, url), hexKey);
                    counter++;
                }
                resolve({});
            } else {
                resolve({});
            }
        });
    }
}
