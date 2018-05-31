import M3U8 from "./m3u8";
export interface DownloaderConfig {
    threads?: number;
    output?: string;
    key?: string;
}
declare class Downloader {
    tempPath: string;
    m3u8Path: string;
    m3u8: M3U8;
    outputPath: string;
    threads: number;
    key: string;
    startedAt: number;
    finishedChunks: number;
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(m3u8Path: string, {threads, output, key}?: DownloaderConfig);
    init(): Promise<void>;
    calculateSpeedByChunk(): string;
    calculateSpeedByRatio(): string;
}
export default Downloader;
