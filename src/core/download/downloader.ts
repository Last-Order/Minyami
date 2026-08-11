import { DownloadEvent, DownloadEventListener, SourceDownloadSnapshot } from "./controller";
import { DownloadSession } from "./session/download_session";
import { DownloaderConfig } from "./types";
import { DownloadSource } from "../source/types";

export type { SourceDownloadSnapshot } from "./controller";

export interface DownloadController {
    download(): Promise<void>;
    /** Stop discovery and drain every task already accepted by the session. */
    stop(): void;
    /** Stop discovery, discard queued work, and cancel active task I/O. */
    abort(): void;
    getSnapshot(): SourceDownloadSnapshot;
    on<TEvent extends DownloadEvent>(event: TEvent, listener: DownloadEventListener<TEvent>): DownloadController;
    once<TEvent extends DownloadEvent>(event: TEvent, listener: DownloadEventListener<TEvent>): DownloadController;
    off<TEvent extends DownloadEvent>(event: TEvent, listener: DownloadEventListener<TEvent>): DownloadController;
}

/** Creates the shared finite/continuous source-driven download lifecycle. */
export function createDownloader(source: DownloadSource, config: DownloaderConfig = {}): DownloadController {
    // The facade exposes commands and observations only; all mutable lifecycle state stays in one session.
    const session = new DownloadSession(source, config);
    const controller: DownloadController = {
        download: () => session.download(),
        stop: () => session.stop(),
        abort: () => session.abort(),
        getSnapshot: () => session.getSnapshot(),
        on(event, listener) {
            session.on(event, listener);
            return controller;
        },
        once(event, listener) {
            session.once(event, listener);
            return controller;
        },
        off(event, listener) {
            session.off(event, listener);
            return controller;
        },
    };
    return controller;
}
