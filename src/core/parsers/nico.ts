import { ParserOptions, ParserResult } from "./types";
import { isChunkGroup, ChunkGroup } from "../downloader";
const ReconnectingWebSocket = require('reconnecting-websocket');
const WebSocket = require('ws');

export default class Parser {
    static updateToken(token: string, downloader: ParserOptions["downloader"]) {
        for (const chunk of downloader.allChunks) {
            if (isChunkGroup(chunk)) {
                for (const c of chunk.chunks) {
                    c.url = c.url.replace(/ht2_nicolive=([^\&]+)/, `ht2_nicolive=${token}`);
                }
            } else {
                chunk.url = chunk.url.replace(/ht2_nicolive=([^\&]+)/, `ht2_nicolive=${token}`);
            }
        }
        for (const chunk of downloader.chunks) {
            if (isChunkGroup(chunk)) {
                chunk.actions.forEach(action => {
                    if (action.actionName === 'ping') {
                        action.actionParams = action.actionParams.replace(/ht2_nicolive=([^\&]+)/, `ht2_nicolive=${token}`);
                    }
                })
                for (const c of chunk.chunks) {
                    c.url = c.url.replace(/ht2_nicolive=([^\&]+)/, `ht2_nicolive=${token}`);
                }
            } else {
                chunk.url = chunk.url.replace(/ht2_nicolive=([^\&]+)/, `ht2_nicolive=${token}`);
            }
        }
    }
    static parse({
        downloader
    }: ParserOptions): ParserResult {
        if (!downloader.m3u8.m3u8Url) {
            throw new Error('Missing m3u8 url for Niconico.');
        }
        if (downloader.key) {
            // NICO Enhanced mode ON!
            downloader.Log.info(`Enhanced mode for Nico-TS enabled`);
            const liveId = downloader.key.match(/(.+?)_/)[1];
            let socketUrl;
            let listened = false;
            if (liveId.startsWith('lv')) {
                socketUrl = `wss://a.live2.nicovideo.jp/wsapi/v1/watch/${liveId}/timeshift?audience_token=${downloader.key}`;
            } else {
                // Channel Live
                socketUrl = `wss://a.live2.nicovideo.jp/unama/wsapi/v1/watch/${liveId}/timeshift?audience_token=${downloader.key}`;
            }
            const socket = new ReconnectingWebSocket(socketUrl, [], {
                WebSocket: WebSocket
            });
            if (listened === false) {
                socket.addEventListener('message', (message: any) => {
                    listened = true;
                    const parsedMessage = JSON.parse(message.data);
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
                            downloader.verbose && downloader.Log.info(`Update token: ${token}`);
                            Parser.updateToken(token, downloader);
                        }
                    }
                });
                socket.addEventListener('open', () => {
                    const payload = { "type": "watch", "body": { "command": "getpermit", "requirement": { "broadcastId": liveId.replace('lv', ''), "route": "", "stream": { "protocol": "hls", "requireNewStream": true, "priorStreamQuality": "super_high", "isLowLatency": true }, "room": { "isCommentable": true, "protocol": "webSocket" } } } };
                    setInterval(() => {
                        socket.send(JSON.stringify(payload))
                    }, 50000 / downloader.threads);
                });
            }
            
        }
        const prefix = downloader.m3u8.m3u8Url.match(/^(.+\/)/)[1];
        const leftPad = (str: string) => {
            return str;
        }
        if (downloader) {
            if (downloader.chunks.length === 0) {
                // 生成 Fake M3U8
                const chunkLength = downloader.m3u8.getChunkLength();
                const videoLength = parseFloat(downloader.m3u8.m3u8Content.match(/#DMC-STREAM-DURATION:(.+)/)[1]);
                const firstChunkFilename = downloader.m3u8.chunks[0].url.match(/^(.+ts)/)[1];
                let offset;
                if (firstChunkFilename === '0.ts') {
                    offset = downloader.m3u8.chunks[1].url.match(/(\d{3})\.ts/)[1];
                } else {
                    offset = downloader.m3u8.chunks[0].url.match(/(\d{3})\.ts/)[1];
                }
                const suffix = downloader.m3u8.chunks[0].url.match(/\.ts(.+)/)[1];
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
                        const pingUrl = downloader.m3u8Path.replace(/start=\d+/ig, `start=${startTime}`)
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
                downloader.chunks = newChunkList;
            } else {
                // 刷新 Token
                const token = downloader.m3u8Path.match(/ht2_nicolive=(.+?)&/)[1];
                Parser.updateToken(token, downloader);
            }
        }
        return {}
    }
}