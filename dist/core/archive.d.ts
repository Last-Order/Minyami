import M3U8 from './m3u8';
import Downloader, { DownloaderConfig } from './downloader';
export interface Chunk {
    url: string;
    filename: string;
}
declare class ArchiveDownloader extends Downloader {
    tempPath: string;
    outputPath: string;
    m3u8Path: string;
    m3u8: M3U8;
    chunks: Chunk[];
    outputFileList: string[];
    totalChunks: number;
    runningThreads: number;
    iv: string;
    prefix: string;
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(m3u8Path: string, {threads, output, key}?: DownloaderConfig);
    download(): Promise<void>;
    handleTask(task: Chunk): Promise<{}>;
    checkQueue(): void;
}
export default ArchiveDownloader;
