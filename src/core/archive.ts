import { timeStringToSeconds } from "../utils/time";
import { ArchiveDownloaderConfig } from "./downloader";
import { DownloadEvent, DownloadEventListener, DownloadSnapshot } from "./download/controller";
import { createDownloader } from "./download/downloader";
import { createHLSSource, HLSSourceOptions } from "./source/hls";

export interface ArchiveDownloadSnapshot extends DownloadSnapshot {
    totalChunkCount: number;
}

export interface ArchiveDownloadController {
    download(): Promise<void>;
    getSnapshot(): ArchiveDownloadSnapshot;
    on(event: DownloadEvent, listener: DownloadEventListener): ArchiveDownloadController;
    once(event: DownloadEvent, listener: DownloadEventListener): ArchiveDownloadController;
    off(event: DownloadEvent, listener: DownloadEventListener): ArchiveDownloadController;
}

export function createArchiveDownloader(
    sourcePath: string,
    config: ArchiveDownloaderConfig = {}
): ArchiveDownloadController {
    const sourceOptions: HLSSourceOptions = { mode: "snapshot" };
    if (config.slice) {
        const [start, end] = config.slice.split("-");
        sourceOptions.slice = {
            start: timeStringToSeconds(start),
            end: timeStringToSeconds(end),
        };
    }
    // Keep the legacy public controller while delegating all execution to the shared source-driven lifecycle.
    const downloader = createDownloader(createHLSSource(sourcePath, sourceOptions), config);
    const controller: ArchiveDownloadController = {
        download: () => downloader.download(),
        getSnapshot: () => {
            const { isEnd: _isEnd, ...snapshot } = downloader.getSnapshot();
            return snapshot;
        },
        on(event, listener) {
            downloader.on(event, listener);
            return controller;
        },
        once(event, listener) {
            downloader.once(event, listener);
            return controller;
        },
        off(event, listener) {
            downloader.off(event, listener);
            return controller;
        },
    };
    return controller;
}
