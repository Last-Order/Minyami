import { DownloadItem } from "./source/types";

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

export interface ArchiveDownloaderConfig extends DownloaderConfig {
    slice?: string;
}

export interface LiveDownloaderConfig extends DownloaderConfig {}

export interface DownloadTask {
    readonly id: number;
    readonly filename: string;
    readonly item: DownloadItem;
    retryCount: number;
}
