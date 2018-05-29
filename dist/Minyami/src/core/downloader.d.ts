export interface DownloaderConfig {
    threads?: number;
}
declare class Downloader {
    chunks: string[];
    threads: number;
    m3u8Path: string;
    m3u8: string;
    /**
     *
     * @param path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(path: string, {threads}?: DownloaderConfig);
    init(): Promise<void>;
}
export default Downloader;
