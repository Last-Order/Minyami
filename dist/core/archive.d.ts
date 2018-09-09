import M3U8 from './m3u8';
import Downloader, { DownloaderConfig, Chunk } from './downloader';
declare class ArchiveDownloader extends Downloader {
    tempPath: string;
    m3u8Path: string;
    m3u8: M3U8;
    chunks: Chunk[];
    outputFileList: string[];
    totalChunks: number;
    runningThreads: number;
    prefix: string;
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(m3u8Path: string, {threads, output, key, verbose, nomux, retries, proxy}?: DownloaderConfig);
    download(): Promise<void>;
    /**
     * calculate ETA
     */
    getETA(): string;
    /**
     * Check task queue
     */
    checkQueue(): void;
}
export default ArchiveDownloader;
