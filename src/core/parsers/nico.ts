import { ParserOptions, ParserResult } from "./types";
import { isChunkGroup, ChunkGroup } from "../downloader";

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
                let counter: number = 0;
                let chunkGroup: ChunkGroup = {
                    chunks: [],
                    isFinished: false,
                    isNew: true
                };
                let startTime;
                for (let time = 0; time < videoLength - chunkLength; time += chunkLength) {
                    if (counter === 0) {
                        startTime = time.toString();
                        const pingUrl = options.downloader.m3u8Path.replace(/start=\d+/ig, `start=${startTime}`)
                        chunkGroup = {
                            actions: [{
                                actionName: 'ping',
                                actionParams: pingUrl.replace('1/ts/playlist.m3u8', 'master.m3u8')
                            }, {
                                actionName: 'ping',
                                actionParams: pingUrl
                            }],
                            chunks: [],
                            isFinished: false,
                            isNew: true
                        };
                    }
                    chunkGroup.chunks.push({
                        url: prefix + (
                            time.toString() === '0' ? 
                            `0.ts${suffix.replace(/start=.+&/ig, `start=${0}&`)}` : 
                            `${leftPad(time.toString())}${offset}.ts${suffix.replace(/start=.+&/ig, `start=${startTime}&`)}`
                        ),
                        filename: `${leftPad(time.toString())}${offset}.ts`
                    });
                    counter++;
                    if (counter === 4) {
                        newChunkList.push(chunkGroup);
                        counter = 0;
                    }
                }
                options.downloader.chunks = newChunkList;
            } else {
                // 刷新 Token
                const token = options.downloader.m3u8Path.match(/ht2_nicolive=(.+?)&/)[1];
                for (const chunk of options.downloader.allChunks) {
                    if (isChunkGroup(chunk)) {
                        for (const c of chunk.chunks) {
                            c.url = c.url.replace(/ht2_nicolive=(.+)/, `ht2_nicolive=${token}`);
                        }
                    } else {
                        chunk.url = chunk.url.replace(/ht2_nicolive=(.+)/, `ht2_nicolive=${token}`);
                    }
                }
                for (const chunk of options.downloader.chunks) {
                    if (isChunkGroup(chunk)) {
                        chunk.actions.forEach(action => {
                            if (action.actionName === 'ping') {
                                action.actionParams = action.actionParams.replace(/ht2_nicolive=(.+)/, `ht2_nicolive=${token}`);
                            }
                        })
                        for (const c of chunk.chunks) {
                            c.url = c.url.replace(/ht2_nicolive=(.+)/, `ht2_nicolive=${token}`);
                        }
                    } else {
                        chunk.url = chunk.url.replace(/ht2_nicolive=(.+)/, `ht2_nicolive=${token}`);
                    }
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