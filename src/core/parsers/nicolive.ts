import { ParserOptions, ParserResult } from "./types";
const ReconnectingWebSocket = require('@eridanussora/reconnecting-websocket');
const WebSocket = require('ws');
const SocksProxyAgent = require('socks-proxy-agent');
import UA from "../../constants/ua";

export default class Parser {
    static parse({
        downloader
    }: ParserOptions): ParserResult {
        if (!downloader.m3u8.m3u8Url) {
            throw new Error('Missing m3u8 url for Niconico.');
        }
        if (!downloader.key) {
            throw new Error('Missing token for Niconico.');
        }
        if (downloader.key.includes('CAS_MODE')) {
            // 试验放送
        } else {
            downloader.once('parsed', () => {
                const liveId = downloader.key.match(/(.+?)_/)[1];
                const isChannelLive = !liveId.startsWith('lv');
                let socketUrl, socket;
                if (!isChannelLive) {
                    socketUrl = `wss://a.live2.nicovideo.jp/wsapi/v2/watch/${liveId}/timeshift?audience_token=${downloader.key}`;
                } else {
                    // Channel Live
                    socketUrl = `wss://a.live2.nicovideo.jp/unama/wsapi/v2/watch/${liveId}/timeshift?audience_token=${downloader.key}`;
                }
                if (downloader.proxy) {
                    const agent = new SocksProxyAgent(`socks5h://${downloader.proxyHost}:${downloader.proxyPort}`);
                    socket = new ReconnectingWebSocket(socketUrl, undefined, {
                        WebSocket: WebSocket,
                        clientOptions: {
                            headers: {
                                'User-Agent': UA.CHROME_DEFAULT_UA
                            },
                            agent
                        }
                    })
                } else {
                    socket = new ReconnectingWebSocket(socketUrl, undefined, {
                        WebSocket: WebSocket,
                        clientOptions: {
                            headers: {
                                'User-Agent': UA.CHROME_DEFAULT_UA
                            }
                        }
                    });
                }
                socket.addEventListener('message', (message: any) => {
                    const parsedMessage = JSON.parse(message.data);
                    // Send heartbeat packet to keep alive
                    if (parsedMessage.type === 'ping') {
                        socket.send(JSON.stringify({
                            type: 'pong',
                            body: {}
                        }));
                    }
                });
            });
        }
        return {};
    }
}