import { M3U8Chunk } from "./m3u8";
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

export interface DownloadTask extends DownloadItem {
    id: number;
    filename: string;
    retryCount: number;
    chunk: M3U8Chunk;
}
