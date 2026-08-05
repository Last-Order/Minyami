import { LiveDownloaderConfig } from "./downloader";
import { DownloadEvent, DownloadEventListener, DownloadSnapshot } from "./download/controller";
import { createDownloader } from "./download/downloader";
import { createHLSSource } from "./source/hls";

export interface LiveDownloadSnapshot extends DownloadSnapshot {
    totalChunkCount: number;
    isEnd: boolean;
}

export interface LiveDownloadController {
    download(): Promise<void>;
    stop(): void;
    getSnapshot(): LiveDownloadSnapshot;
    on(event: DownloadEvent, listener: DownloadEventListener): LiveDownloadController;
    once(event: DownloadEvent, listener: DownloadEventListener): LiveDownloadController;
    off(event: DownloadEvent, listener: DownloadEventListener): LiveDownloadController;
}

export function createLiveDownloader(m3u8Path: string, config: LiveDownloaderConfig = {}): LiveDownloadController {
    // Live behavior is a follow-mode source, not a separate scheduler or output implementation.
    const downloader = createDownloader(createHLSSource(m3u8Path, { mode: "follow" }), config);
    const controller: LiveDownloadController = {
        download: () => downloader.download(),
        stop: () => downloader.stop(),
        getSnapshot: () => downloader.getSnapshot(),
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
