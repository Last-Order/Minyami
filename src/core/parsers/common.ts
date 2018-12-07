import { ParserOptions, ParserResult } from "./types";
import { requestRaw } from "../../utils/media";
import CommonUtils from '../../utils/common';

export default class Parser {
    static parse({
        downloader
    }: ParserOptions): Promise<ParserResult> {
        return new Promise(async (resolve, reject) => {
            if (downloader.m3u8.isEncrypted) {
                const keys = {};
                keys[CommonUtils.buildFullUrl(downloader.m3u8.m3u8Url, downloader.m3u8.key)] = '';
                // collect all key urls
                for (const chunk of downloader.m3u8.chunks) {
                    if (chunk.key && !keys[chunk.key]) {
                        keys[CommonUtils.buildFullUrl(downloader.m3u8.m3u8Url, chunk.key)] = '';
                    }
                }
                // download all keys
                let counter = 1;
                for (const url of Object.keys(keys)) {
                    downloader.Log.info(`Downloading decrypt keys. (${counter} / ${Object.keys(keys).length})`);
                    let response;
                    if (downloader.proxy) {
                        response = await requestRaw(url, {
                            host: downloader.proxyHost,
                            port: downloader.proxyPort
                        }, {
                                responseType: 'arraybuffer'
                            });
                    } else {
                        response = await requestRaw(url, null, {
                            responseType: 'arraybuffer'
                        });
                    }
                    const hexKey =
                        Array.from(
                            new Uint8Array(response.data)
                        ).map(
                            i => i.toString(16).length === 1 ? '0' + i.toString(16) : i.toString(16)
                        ).join('');
                    downloader.saveEncryptionKey(CommonUtils.buildFullUrl(
                        downloader.m3u8.m3u8Url, url
                    ), hexKey);
                    counter++;
                }
                resolve({});
            } else {
                resolve({});
            }
        })
    }
}