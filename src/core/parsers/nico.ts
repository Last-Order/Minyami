import { ParserOptions, ParserResult } from "./types";

export default class Parser {
    static parse({
        key = '',
        iv = '',
        options
    }: ParserOptions): ParserResult { 
        if (!options.m3u8Url) {
            throw new Error('Missing m3u8 url for Niconico.');
        }
        const prefix = options.m3u8Url.match(/^(.+\/)/)[1];
        const leftPad = (str: string) => {
            // while (str.length < 3) {
            //     str = '0' + str;
            // }
            return str;
        }
        if (options.downloader) {
            if (options.downloader.chunks.length === 0) {
                // 生成 Fake M3U8
                const chunkLength = options.downloader.m3u8.getChunkLength();
                const videoLength = parseFloat(options.downloader.m3u8.m3u8Content.match(/#DMC-STREAM-DURATION:(.+)/)[1]);
                const firstChunkFilename = options.downloader.m3u8.chunks[0].match(/^(.+ts)/)[1];
                let offset;
                if (firstChunkFilename === '0.ts') {
                    offset = options.downloader.m3u8.chunks[1].match(/(\d{3})\.ts/)[1];
                } else {
                    offset = options.downloader.m3u8.chunks[0].match(/(\d{3})\.ts/)[1];
                }
                const suffix = options.downloader.m3u8.chunks[0].match(/ts(.+)/)[1];
                const newChunkList = [];
                for (let time = 0; time < videoLength - chunkLength; time += chunkLength) {
                    newChunkList.push(
                        time.toString() === '0' ? `0.ts${suffix}` : `${leftPad(time.toString())}${offset}.ts${suffix}`
                    );
                }
                options.downloader.m3u8.chunks = newChunkList;
            } else {
                // 刷新 Token
                const token = options.downloader.m3u8Path.match(/ht2_nicolive=(.+?)&/)[1];
                for (const chunk of options.downloader.allChunks) {
                    chunk.url = chunk.url.replace(/ht2_nicolive=(.+)/, `ht2_nicolive=${token}`);
                }
                for (const chunk of options.downloader.chunks) {
                    chunk.url = chunk.url.replace(/ht2_nicolive=(.+)/, `ht2_nicolive=${token}`);
                }
            }
        }
        return {
            key,
            iv,
            prefix: prefix,
        }
    }
}