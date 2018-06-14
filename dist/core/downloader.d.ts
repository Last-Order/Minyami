import M3U8 from "./m3u8";
export interface DownloaderConfig {
    threads?: number;
    output?: string;
    key?: string;
    verbose?: boolean;
}
export interface Chunk {
    url: string;
    filename: string;
}
declare class Downloader {
    tempPath: string;
    m3u8Path: string;
    m3u8: M3U8;
    outputPath: string;
    threads: number;
    key: string;
    iv: string;
    verbose: boolean;
    startedAt: number;
    finishedChunks: number;
    retry: number;
    timeout: number;
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(m3u8Path: string, {threads, output, key, verbose}?: DownloaderConfig);
    init(): Promise<void>;
    handleTask(task: Chunk): Promise<{}>;
    calculateSpeedByChunk(): string;
    calculateSpeedByRatio(): string;
}
export default Downloader;
