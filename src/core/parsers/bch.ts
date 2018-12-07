import { ParserOptions, ParserResult } from "./types";
import { requestRaw } from "../../utils/media";

export default class Parser {
    static prefix = '';
    static async parse({
        downloader
    }: ParserOptions): Promise<ParserResult> {
        const response = await requestRaw(downloader.m3u8.key, {
            host: downloader.proxyHost,
            port: downloader.proxyPort
        }, {
            responseType: 'arraybuffer'
        });
        const hexKey =
            Array.from(
                new Uint8Array(response.data)
            ).map(
                i => i.toString(16).length === 1 ? '0' + i.toString(16) : i.toString(16)
            ).join('');
        downloader.saveEncryptionKey(downloader.m3u8.key, hexKey);
        return {

        };
    }
}