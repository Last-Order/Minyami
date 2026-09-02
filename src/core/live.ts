import { createDownloader, DownloadController } from "./download/downloader";
import { DownloaderConfig } from "./download/types";
import { createHLSSource, HLSExplicitKey } from "./source/hls";
import { StreamSelector } from "./source/stream_selection";

export interface LiveDownloaderConfig extends DownloaderConfig {
    streamSelector?: StreamSelector;
    explicitKeys?: readonly HLSExplicitKey[];
}

export function createLiveDownloader(sourcePath: string, config: LiveDownloaderConfig = {}): DownloadController {
    // Follow mode is a source behavior; it does not require a second scheduler or output lifecycle.
    const { streamSelector, explicitKeys, ...downloaderConfig } = config;
    return createDownloader(
        createHLSSource(sourcePath, { mode: "follow", streamSelector, explicitKeys }),
        downloaderConfig,
    );
}
