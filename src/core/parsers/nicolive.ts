const ReconnectingWebSocket = require("@eridanussora/reconnecting-websocket");
const WebSocket = require("ws");
import UA from "../../constants/ua";
import { ParserOptions, ParserResult } from "./types";

export function parseNicoLive({ playlist, key, http }: ParserOptions): ParserResult {
    if (!playlist.m3u8Url) {
        throw new Error("Missing m3u8 url for Niconico.");
    }
    if (!key) {
        throw new Error("Missing token for Niconico.");
    }

    let socket: any;
    const closeSocket = () => {
        if (socket) {
            socket.close();
            socket = undefined;
        }
    };

    return {
        lifecycle: {
            onParsed: () => {
                const liveIdMatch = key.match(/(.+?)_/);
                if (!liveIdMatch) {
                    throw new Error("Invalid Niconico token.");
                }
                const liveId = liveIdMatch[1];
                const isChannelLive = !liveId.startsWith("lv");
                const socketUrl = isChannelLive
                    ? `wss://a.live2.nicovideo.jp/unama/wsapi/v2/watch/${liveId}/timeshift?audience_token=${key}`
                    : `wss://a.live2.nicovideo.jp/wsapi/v2/watch/${liveId}/timeshift?audience_token=${key}`;
                socket = new ReconnectingWebSocket(socketUrl, undefined, {
                    WebSocket,
                    clientOptions: {
                        headers: { "User-Agent": UA.CHROME_DEFAULT_UA },
                        agent: http.agent || undefined,
                    },
                });
                socket.addEventListener("message", (message: any) => {
                    const parsedMessage = JSON.parse(message.data);
                    if (parsedMessage.type === "ping") {
                        socket.send(JSON.stringify({ type: "pong", body: {} }));
                        socket.send(JSON.stringify({ type: "keepSeat" }));
                    }
                });
            },
            onDownloaded: closeSocket,
            onFinished: closeSocket,
            onCriticalError: closeSocket,
        },
    };
}
