import { ParserOptions, ParserResult } from "./types";
const ReconnectingWebSocket = require('reconnecting-websocket');
const WebSocket = require('ws');
const SocksProxyAgent = require('socks-proxy-agent');

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
            downloader.afterFirstParse = () => {
                const liveId = downloader.key.match(/(.+?)_/)[1];
                let socketUrl, socket;
                if (liveId.startsWith('lv')) {
                    socketUrl = `wss://a.live2.nicovideo.jp/wsapi/v1/watch/${liveId}/timeshift?audience_token=${downloader.key}`;
                } else {
                    // Channel Live
                    socketUrl = `wss://a.live2.nicovideo.jp/unama/wsapi/v1/watch/${liveId}/timeshift?audience_token=${downloader.key}`;
                }
                if (downloader.proxy) {
                    const agent = new SocksProxyAgent(`socks5h://${downloader.proxyHost}:${downloader.proxyPort}`);
                    socket = new ReconnectingWebSocket(socketUrl, {
                        agent
                    }, {
                            WebSocket: WebSocket
                        })
                } else {
                    socket = new ReconnectingWebSocket(socketUrl, [], {
                        WebSocket: WebSocket
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
                })
            }
        }
        return {};
    }
}