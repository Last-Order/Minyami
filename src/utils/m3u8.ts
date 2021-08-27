import * as fs from "fs";
import { URL } from "url";
import axios, { AxiosRequestConfig } from "axios";
import M3U8 from "../core/m3u8";
import ProxyAgentHelper from "../utils/agent";
import logger from "../utils/log";

export async function loadM3U8(path: string, retries: number = 1, timeout = 60000, options: AxiosRequestConfig = {}) {
    const proxyAgent = ProxyAgentHelper.getProxyAgentInstance();
    let m3u8Content;
    if (path.startsWith("http")) {
        logger.info("Start fetching M3U8 file.");
        while (retries >= 0) {
            try {
                const response = await axios.get(path, {
                    timeout,
                    httpsAgent: proxyAgent ? proxyAgent : undefined,
                    headers: {
                        Host: new URL(path).host,
                    },
                    ...options,
                });
                logger.info("M3U8 file fetched.");
                m3u8Content = response.data;
                break;
            } catch (e) {
                logger.warning(
                    `Fail to fetch M3U8 file: [${
                        e.code ||
                        (e.response ? `${e.response.status} ${e.response.statusText}` : undefined) ||
                        "UNKNOWN"
                    }]`
                );
                logger.warning("If you are downloading a live stream, this may result in a broken output video.");
                retries--;
                if (retries >= 0) {
                    logger.info("Try again.");
                } else {
                    logger.warning("Max retries exceeded. Abort.");
                    throw new Error(e);
                }
            }
        }
    } else {
        // is a local file path
        if (!fs.existsSync(path)) {
            throw new Error(`File '${path}' not found.`);
        }
        logger.info("Loading M3U8 file.");
        m3u8Content = fs.readFileSync(path).toString();
    }
    return new M3U8(m3u8Content, path);
}
