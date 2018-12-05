import { ParserOptions, ParserResult } from "./types";
import { isChunkGroup, ChunkGroup } from "../downloader";
import * as Websocket from 'ws';

export default class Parser {
    static updateToken(token: string, options: ParserOptions["options"]) {
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
    static parse({
        key = '',
        iv = '',
        options
    }: ParserOptions): ParserResult {
        if (!options.m3u8Url) {
            throw new Error('Missing m3u8 url for Niconico.');
        }
        if (options.key) {
            // NICO Enhanced mode ON!
            options.downloader.Log.info(`Enhanced mode for Nico-TS enabled`);
            const liveId = options.key.match(/(.+?)_/)[1];
            let socketUrl;
            if (liveId.startsWith('lv')) {
                socketUrl = `wss://a.live2.nicovideo.jp/wsapi/v1/watch/${liveId}/timeshift?audience_token=${options.key}`;
            } else {
                // Channel Live
                socketUrl = `wss://a.live2.nicovideo.jp/unama/wsapi/v1/watch/${liveId}/timeshift?audience_token=${options.key}`;
            }
            const socket = new Websocket(socketUrl);
            socket.on('message', (message: string) => {
                const parsedMessage = JSON.parse(message);
                // Send heartbeat packet to keep alive
                if (parsedMessage.type === 'ping') {
                    socket.send(JSON.stringify({
                        type: 'pong',
                        body: {}
                    }));
                }
                // Update stream token
                if (parsedMessage.type === 'watch') {
                    if (parsedMessage.body.command === 'currentstream') {
                        let token;
                        if (liveId.startsWith('lv')) {
                            token = parsedMessage.body.currentStream.mediaServerAuth.value;
                        } else {
                            // Channel Live
                            token = parsedMessage.body.currentStream.uri.match(/ht2_nicolive=(.+)/)[1];
                        }
                        options.downloader.verbose && options.downloader.Log.info(`Update token: ${token}`);
                        Parser.updateToken(token, options);
                    }
                }
            });
            socket.on('open', () => {
                setInterval(() => {
                    socket.send(JSON.stringify({ "type": "watch", "body": { "command": "getpermit", "requirement": { "broadcastId": liveId.replace('lv', ''), "route": "", "stream": { "protocol": "hls", "requireNewStream": true, "priorStreamQuality": "super_high", "isLowLatency": true }, "room": { "isCommentable": true, "protocol": "webSocket" } } } }))
                }, 100000 / options.downloader.threads);
            });
        }
        const prefix = options.m3u8Url.match(/^(.+\/)/)[1];
        const leftPad = (str: string) => {
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
                Parser.updateToken(token, options);
            }
        }
        return {
            key,
            iv,
            prefix: prefix,
        }
    }
}