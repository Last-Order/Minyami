import { Muxer } from "../muxer";

export interface DownloaderConfig {
    threads?: number;
    output?: string;
    tempDir?: string;
    cookies?: string;
    headers?: string | string[];
    sourceRequestAttempts?: number;
    taskAttempts?: number;
    proxy?: string;
    noMerge?: boolean;
    keepTemporaryFiles?: boolean;
    keepEncryptedChunks?: boolean;
    /** Ordered muxer candidates; omit for mkvmerge then ffmpeg, or pass [] to disable cross-track muxing. */
    muxers?: readonly Muxer[];
}
