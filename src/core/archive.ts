import { timeStringToSeconds } from "../utils/time";
import { createDownloader, DownloadController } from "./download/downloader";
import { DownloaderConfig } from "./download/types";
import { createHLSSource, HLSSourceOptions } from "./source/hls";
import { StreamSelector } from "./source/stream_selection";

export interface ArchiveDownloaderConfig extends DownloaderConfig {
    slice?: string;
    streamSelector?: StreamSelector;
    explicitKeys?: readonly string[];
}

export function createArchiveDownloader(sourcePath: string, config: ArchiveDownloaderConfig = {}): DownloadController {
    // Consume protocol options at this boundary so the generic downloader sees only execution/output policy.
    const { slice, streamSelector, explicitKeys, ...downloaderConfig } = config;
    const sourceOptions: HLSSourceOptions = { mode: "snapshot", streamSelector, explicitKeys };
    if (slice) {
        const [start, end] = slice.split("-");
        sourceOptions.slice = {
            start: timeStringToSeconds(start),
            end: timeStringToSeconds(end),
        };
    }
    return createDownloader(createHLSSource(sourcePath, sourceOptions), downloaderConfig);
}
