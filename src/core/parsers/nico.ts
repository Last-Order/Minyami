const ReconnectingWebSocket = require("@eridanussora/reconnecting-websocket");
const WebSocket = require("ws");
import UA from "../../constants/ua";
import logger from "../../utils/log";
import { DownloadTask, DownloadTaskGroup, DownloadTaskItem } from "../downloader";
import { ParserOptions, ParserResult } from "./types";

interface TokenState {
    token?: string;
    host?: string;
}

function rewriteTaskUrl(url: string, state: TokenState): string {
    let result = state.token ? url.replace(/ht2_nicolive=([^&]+)/, `ht2_nicolive=${state.token}`) : url;
    if (state.host) {
        result = result.replace(/(http(s):\/\/.+\/)(\d\/ts)/, `${state.host}$3`);
    }
    return result;
}

function rewriteActionUrl(url: string, state: TokenState): string {
    let result = state.token ? url.replace(/ht2_nicolive=([^&]+)/, `ht2_nicolive=${state.token}`) : url;
    if (state.host) {
        result = result.replace(/(http(s):\/\/.+\/)/gi, state.host);
    }
    return result;
}

function buildFakeTasks(options: ParserOptions): DownloadTaskItem[] {
    const { playlist, m3u8Path } = options;
    const chunkLength = playlist.getChunkLength();
    const durationMatch = playlist.m3u8Content.match(/#DMC-STREAM-DURATION:(.+)/);
    if (!durationMatch || playlist.chunks.length === 0) {
        throw new Error("Invalid Niconico playlist.");
    }

    const videoLength = parseFloat(durationMatch[1]);
    const firstChunkUrl = playlist.chunks[0].url.split("/").slice(-1)[0];
    const firstFilenameMatch = firstChunkUrl.match(/^(.+ts)/);
    if (!firstFilenameMatch) {
        throw new Error("Invalid Niconico chunk URL.");
    }
    const offsetSource = firstFilenameMatch[1] === "0.ts" ? playlist.chunks[1] : playlist.chunks[0];
    const offsetMatch = offsetSource?.url.match(/(\d{1,3})\.ts/);
    const suffixMatch = playlist.chunks[0].url.match(/\.ts(.+)/);
    if (!offsetMatch || !suffixMatch) {
        throw new Error("Invalid Niconico chunk URL.");
    }

    const prefixMatch = playlist.m3u8Url.match(/^(.+\/)/);
    if (!prefixMatch) {
        throw new Error("Missing m3u8 url for Niconico.");
    }
    const prefix = prefixMatch[1];
    const offset = offsetMatch[1].padStart(3, "0");
    const suffix = suffixMatch[1];
    const tasks: DownloadTaskGroup[] = [];
    let counter = 0;
    let sequenceId = 0;
    let startTime = "0";
    let group: DownloadTaskGroup;

    for (let time = 0; time < videoLength; time += chunkLength) {
        if (counter === 0) {
            startTime = time.toString();
            const pingUrl = m3u8Path.replace(/start=\d+/gi, `start=${startTime}`);
            group = {
                actions: [
                    {
                        actionName: "ping",
                        actionParams: pingUrl.replace("1/ts/playlist.m3u8", "master.m3u8"),
                    },
                ],
                subTasks: [],
                isFinished: false,
                isNew: true,
            };
        }
        if (videoLength - parseFloat(`${time}.${offset}`) < 1) {
            continue;
        }
        const task: DownloadTask = {
            filename: `${time}${offset}.ts`,
            retryCount: 0,
            id: sequenceId,
            chunk: {
                isEncrypted: false,
                isInitialChunk: false,
                length: 5.0,
                sequenceId,
                url:
                    prefix +
                    (time === 0
                        ? `0.ts${suffix.replace(/start=.+&/gi, "start=0&")}`
                        : `${time}${offset}.ts${suffix.replace(/start=.+&/gi, `start=${startTime}&`)}`),
            },
        };
        group.subTasks.push(task);
        counter++;
        sequenceId++;
        if (counter === 4) {
            tasks.push(group);
            counter = 0;
        }
    }
    if (counter !== 0) {
        tasks.push(group);
    }
    return tasks;
}

export function parseNico(options: ParserOptions): ParserResult {
    const { playlist, key, threads, http, currentTasks = [] } = options;
    if (!playlist.m3u8Url) {
        throw new Error("Missing m3u8 url for Niconico.");
    }

    const tokenState: TokenState = {
        token: options.m3u8Path.match(/ht2_nicolive=(.+?)&/)?.[1],
    };
    let socket: any;
    let refreshInterval: NodeJS.Timeout;

    const closeSocket = () => {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = undefined;
        }
        if (socket) {
            socket.close();
            socket = undefined;
        }
    };

    const lifecycle = key
        ? {
              onParsed: () => {
                  const [audienceToken, quality = "super_high"] = key.split(",");
                  const liveIdMatch = audienceToken.match(/(.+?)_/);
                  if (!liveIdMatch) {
                      throw new Error("Invalid Niconico audience token.");
                  }
                  logger.info("NICO Enhanced mode ON!");
                  const liveId = liveIdMatch[1];
                  const isChannelLive = !liveId.startsWith("lv");
                  const socketUrl = isChannelLive
                      ? `wss://a.live2.nicovideo.jp/unama/wsapi/v2/watch/${liveId}/timeshift?audience_token=${audienceToken}`
                      : `wss://a.live2.nicovideo.jp/wsapi/v2/watch/${liveId}/timeshift?audience_token=${audienceToken}`;
                  socket = new ReconnectingWebSocket(socketUrl, undefined, {
                      WebSocket,
                      clientOptions: {
                          headers: { "User-Agent": UA.CHROME_DEFAULT_UA },
                          ...(http.agent ? { agent: http.agent } : {}),
                      },
                  });
                  socket.addEventListener("message", (message: any) => {
                      const parsedMessage = JSON.parse(message.data);
                      if (parsedMessage.type === "ping") {
                          socket.send(JSON.stringify({ type: "pong" }));
                          socket.send(JSON.stringify({ type: "keepSeat" }));
                      }
                      if (parsedMessage.type === "stream") {
                          tokenState.token = parsedMessage.data.uri.match(/ht2_nicolive=(.+)/)?.[1];
                          tokenState.host = parsedMessage.data.uri.match(/(http(s):\/\/.+\/)/)?.[1];
                          logger.info(`Update Token: ${tokenState.token}`);
                      }
                  });
                  socket.addEventListener("open", () => {
                      const payload = {
                          type: "startWatching",
                          data: {
                              stream: {
                                  quality,
                                  protocol: "hls",
                                  latency: "low",
                                  chasePlay: false,
                              },
                              room: { protocol: "webSocket", commentable: true },
                              reconnect: false,
                          },
                      };
                      refreshInterval = setInterval(() => socket.send(JSON.stringify(payload)), 50000 / threads);
                  });
              },
              onDownloaded: closeSocket,
              onFinished: closeSocket,
              onCriticalError: closeSocket,
          }
        : undefined;

    return {
        autoGenerateTasks: false,
        ...(currentTasks.length === 0 ? { tasks: buildFakeTasks(options) } : {}),
        prepareTask: (task) => ({
            ...task,
            chunk: { ...task.chunk, url: rewriteTaskUrl(task.chunk.url, tokenState) },
        }),
        prepareAction: (action) => ({
            ...action,
            actionParams: rewriteActionUrl(action.actionParams, tokenState),
        }),
        lifecycle,
    };
}
