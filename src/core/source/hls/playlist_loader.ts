import * as fs from "fs";
import logger from "../../../utils/log";
import { DownloadHttpClient } from "../../download/http_client";
import HLSParser, { MasterPlaylist, MediaPlaylist } from "./parser";

export interface LoadPlaylistOptions {
    retries?: number;
    timeout?: number;
    initPrimaryKey?: number;
}

export class PlaylistLoader {
    constructor(private readonly http: DownloadHttpClient) {}

    async load(sourcePath: string, options: LoadPlaylistOptions = {}): Promise<MasterPlaylist | MediaPlaylist> {
        const retries = options.retries === undefined ? 1 : options.retries;
        const timeout = options.timeout || 60000;

        if (!sourcePath.startsWith("http")) {
            if (!fs.existsSync(sourcePath)) {
                throw new Error(`File '${sourcePath}' not found.`);
            }
            logger.info("Loading HLS playlist.");
            return new HLSParser({
                content: fs.readFileSync(sourcePath).toString(),
                initPrimaryKey: options.initPrimaryKey,
            }).parse();
        }

        logger.info("Start fetching HLS playlist.");
        let retriesLeft = retries;
        while (retriesLeft >= 0) {
            try {
                const response = await this.http.get<string>(sourcePath, { timeout });
                logger.info("HLS playlist fetched.");
                const responseUrl = response.request?.res?.responseUrl || sourcePath;
                return new HLSParser({
                    content: response.data,
                    playlistUrl: responseUrl,
                    initPrimaryKey: options.initPrimaryKey,
                }).parse();
            } catch (error) {
                const e = error as any;
                const reason =
                    e.code ||
                    (e.response ? `${e.response.status} ${e.response.statusText}` : undefined) ||
                    e.message ||
                    "UNKNOWN";
                logger.warning(`Fail to fetch M3U8 file: [${reason}]`);
                logger.warning("If you are downloading a live stream, this may result in a broken output video.");
                retriesLeft--;
                if (retriesLeft >= 0) {
                    logger.info("Try again.");
                } else {
                    logger.warning("Max retries exceeded. Abort.");
                    throw error;
                }
            }
        }

        throw new Error("Unable to load M3U8 file.");
    }
}
