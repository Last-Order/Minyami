const ReconnectingWebSocket = require("@eridanussora/reconnecting-websocket");
const WebSocket = require("ws");
import ProxyAgentHelper from "../../utils/agent";
import UA from "../../constants/ua";
import { ParserOptions, ParserResult } from "./types";

export default class Parser {
    static parse({ downloader }: ParserOptions): ParserResult {
        if (!downloader.m3u8.m3u8Url) {
            throw new Error("Missing m3u8 url for Niconico.");
        }
        if (!downloader.key) {
            throw new Error("Missing token for Niconico.");
        }
        const proxyAgent = ProxyAgentHelper.getProxyAgentInstance();
        downloader.once("parsed", () => {
            const liveId = downloader.key.match(/(.+?)_/)[1];
            const isChannelLive = !liveId.startsWith("lv");
            const socketUrl = isChannelLive
                ? `wss://a.live2.nicovideo.jp/unama/wsapi/v2/watch/${liveId}/timeshift?audience_token=${downloader.key}`
                : `wss://a.live2.nicovideo.jp/wsapi/v2/watch/${liveId}/timeshift?audience_token=${downloader.key}`;
            const socket = new ReconnectingWebSocket(socketUrl, undefined, {
                WebSocket: WebSocket,
                clientOptions: {
                    headers: {
                        "User-Agent": UA.CHROME_DEFAULT_UA,
                    },
                    agent: proxyAgent ? proxyAgent : undefined,
                },
            });

            socket.addEventListener("message", (message: any) => {
                const parsedMessage = JSON.parse(message.data);
                // Send heartbeat packet to keep alive
                if (parsedMessage.type === "ping") {
                    socket.send(
                        JSON.stringify({
                            type: "pong",
                            body: {},
                        })
                    );
                    socket.send(
                        JSON.stringify({
                            type: "keepSeat",
                        })
                    );
                }
            });
        });
        return {};
    }
}
