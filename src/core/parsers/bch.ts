import { ParserOptions, ParserResult } from "./types";
import Log from "../../utils/log";
import { requestRaw } from "../../utils/media";

export default class Parser {
    static prefix = '';
    static async parse({
        key = '',
        iv = '',
        options
    }: ParserOptions): Promise<ParserResult> {
        Log.info('Retrieving key from server.')
        const response = await requestRaw(key, options.proxy, {
            responseType: 'arraybuffer'
        })
        const hexKey = 
            Array.from(
                new Uint8Array(response.data)
            ).map(
                i => i.toString(16).length === 1 ? '0' + i.toString(16) : i.toString(16)
            ).join('');
        const sequenceId = options.m3u8.m3u8Content.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)[1];
        return {
            key: hexKey, 
            iv: sequenceId,
            prefix: Parser.prefix
        }
    }
}