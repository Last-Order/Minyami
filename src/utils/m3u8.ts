import * as fs from "fs";
import { URL } from "url";
import axios from "axios";
import M3U8 from "../core/m3u8";
import ProxyAgentHelper from "../utils/agent";
import logger from "../utils/log";

interface LoadM3U8Options {
    path: string;
    retries?: number;
    timeout?: number;
    initPrimaryKey?: number;
}

export async function loadM3U8({ path, retries = 1, timeout = 60000, initPrimaryKey }: LoadM3U8Options) {
    const proxyAgent = ProxyAgentHelper.getProxyAgentInstance();
    let m3u8Content, m3u8Path;
    if (path.startsWith("http")) {
        logger.info("Start fetching M3U8 file.");
        while (retries >= 0) {
            const CancelToken = axios.CancelToken;
            let source = CancelToken.source();
            setTimeout(() => {
                source && source.cancel();
                source = null;
            }, timeout);
            try {
                const response = await axios.get(path, {
                    timeout,
                    httpsAgent: proxyAgent ? proxyAgent : undefined,
                    headers: {
                        ...(!axios.defaults.headers.common["Host"] ? { Host: new URL(path).host } : {}),
                    },
                    cancelToken: source.token,
                });
                logger.info("M3U8 file fetched.");
                m3u8Content = response.data;
                m3u8Path = response.request.res.responseUrl || path;
                break;
            } catch (e) {
                logger.warning(
                    `Fail to fetch M3U8 file: [${
                        e.code ||
                        (e.response ? `${e.response.status} ${e.response.statusText}` : undefined) ||
                        e.message ||
                        "UNKNOWN"
                    }]`
                );
                logger.warning("If you are downloading a live stream, this may result in a broken output video.");
                retries--;
                if (retries >= 0) {
                    logger.info("Try again.");
                } else {
                    logger.warning("Max retries exceeded. Abort.");
                    throw e;
                }
            } finally {
                source = null;
            }
        }
        const m3u8 = new M3U8({ m3u8Content, m3u8Url: m3u8Path, initPrimaryKey });
        return m3u8.parse();
    } else {
        // is a local file path
        if (!fs.existsSync(path)) {
            throw new Error(`File '${path}' not found.`);
        }
        logger.info("Loading M3U8 file.");
        m3u8Content = fs.readFileSync(path).toString();
        const m3u8 = new M3U8({ m3u8Content });
        return m3u8.parse();
    }
}
