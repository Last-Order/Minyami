import { DownloadItem, DownloadTrackId } from "./source/types";

export interface DownloaderConfig {
    threads?: number;
    output?: string;
    tempDir?: string;
    key?: string;
    verbose?: boolean;
    cookies?: string;
    headers?: string | string[];
    retries?: number;
    proxy?: string;
    format?: string;
    noMerge?: boolean;
    keep?: boolean;
    keepEncryptedChunks?: boolean;
    cliMode?: boolean;
}

export interface DownloadTask {
    /** Global discovery order shared by every track. */
    readonly id: number;
    readonly trackId: DownloadTrackId;
    /** Merge order within this task's track. */
    readonly trackIndex: number;
    readonly filename: string;
    readonly item: DownloadItem;
    retryCount: number;
}
