export interface DownloaderConfig {
    threads?: number;
    output?: string;
}
export interface Chunk {
    url: string;
    filename: string;
}
declare class Downloader {
    tempPath: string;
    outputPath: string;
    m3u8Path: string;
    chunks: Chunk[];
    outputFileList: string[];
    totalChunks: number;
    finishedChunks: number;
    threads: number;
    runningThreads: number;
    m3u8Content: string;
    key: string;
    iv: string;
    prefix: string;
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(m3u8Path: string, {threads, output}?: DownloaderConfig);
    init(): Promise<void>;
    download(): Promise<void>;
    handleTask(task: Chunk): Promise<{}>;
    checkQueue(): void;
}
export default Downloader;
