import { ParserOptions, ParserResult } from "./types";
import Log from "../../utils/log";

export default class Parser {
    static parse({
        key = '',
        iv = '',
        options
    }: ParserOptions): ParserResult { 
        if (!options.m3u8Url) {
            Log.error('Missing m3u8 url for openrec.');
        }
        const prefix = options.m3u8Url.match(/^(.+\/)/)[1];
        const leftPad = (str: string) => {
            while (str.length < 3) {
                str = '0' + str;
            }
            return str;
        }
        if (options.m3u8) {
            // 生成 Fake M3U8
            const chunkLength = options.m3u8.getChunkLength();
            const videoLength = parseFloat(options.m3u8.m3u8Content.match(/#DMC-STREAM-DURATION:(.+)/)[1]);
            const offset = options.m3u8.chunks[0].match(/(\d{3})\.ts/)[1];
            const suffix = options.m3u8.chunks[0].match(/ts(.+)/)[1];
            const newChunkList = [];
            for (let time = 0; time < videoLength - chunkLength; time += chunkLength) {
                newChunkList.push(
                    `${leftPad(time.toString())}${offset}.ts${suffix}`
                );
            }
            options.m3u8.chunks = newChunkList;
            return {
                key,
                iv,
                prefix: prefix,
                m3u8: options.m3u8
            }
        }
        return {
            key,
            iv,
            prefix: prefix,
        }
    }
}