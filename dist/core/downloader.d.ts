import M3U8 from "./m3u8";
export interface DownloaderConfig {
    threads?: number;
    output?: string;
    key?: string;
    verbose?: boolean;
    nomux?: boolean;
    retries?: number;
    proxy?: string;
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
    chunks: Chunk[];
    pickedChunks: Chunk[];
    key: string;
    iv: string;
    verbose: boolean;
    nomux: boolean;
    startedAt: number;
    finishedChunksCount: number;
    retries: number;
    timeout: number;
    proxy: string;
    proxyHost: string;
    proxyPort: number;
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(m3u8Path: string, {threads, output, key, verbose, nomux, retries, proxy}?: DownloaderConfig);
    /**
     * 初始化 读取m3u8内容
     */
    init(): Promise<void>;
    loadM3U8(): Promise<void>;
    /**
     * 退出前的清理工作
     */
    clean(): Promise<void>;
    /**
     * 处理块下载任务
     * @param task 块下载任务
     */
    handleTask(task: Chunk): Promise<{}>;
    /**
     * 计算以块计算的下载速度
     */
    calculateSpeedByChunk(): string;
    /**
     * 计算以视频长度为基准下载速度倍率
     */
    calculateSpeedByRatio(): string;
}
export default Downloader;
