import * as fs from "fs";
import logger from "../../../utils/log";
import { DownloadSourceHttpClient } from "../types";
import { HLSPlaylist, parseHLSPlaylist } from "./parser";

export interface LoadPlaylistOptions {
    timeout?: number;
    signal?: AbortSignal;
}

export class PlaylistLoader {
    constructor(private readonly http: DownloadSourceHttpClient) {}

    async load(sourcePath: string, options: LoadPlaylistOptions = {}): Promise<HLSPlaylist> {
        const timeout = options.timeout || 60000;

        if (!sourcePath.startsWith("http")) {
            if (!fs.existsSync(sourcePath)) {
                throw new Error(`File '${sourcePath}' not found.`);
            }
            logger.info("Loading HLS playlist.");
            return parseHLSPlaylist({
                content: fs.readFileSync(sourcePath).toString(),
            });
        }

        logger.info("Start fetching HLS playlist.");
        let content: string;
        let playlistUrl: string;
        try {
            const response = await this.http.get<string>(sourcePath, { timeout, signal: options.signal });
            content = response.data;
            // Relative playlist references must resolve against the final URL after redirects, not the requested URL.
            playlistUrl = response.request?.res?.responseUrl || sourcePath;
        } catch (error) {
            const e = error as any;
            const reason =
                e.code ||
                (e.response ? `${e.response.status} ${e.response.statusText}` : undefined) ||
                e.message ||
                "UNKNOWN";
            logger.warning(`Fail to fetch M3U8 file: [${reason}]`);
            logger.warning("If you are downloading a live stream, this may result in a broken output video.");
            logger.warning("Source request attempts exhausted. Abort.");
            throw error;
        }
        logger.info("HLS playlist fetched.");
        return parseHLSPlaylist({ content, playlistUrl });
    }
}
