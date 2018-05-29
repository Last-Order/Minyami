import { DownloaderConfig } from "./downloader";
import M3U8 from "./m3u8";
declare class Downloader {
    tempPath: any;
    m3u8Path: string;
    m3u8: M3U8;
    outputPath: string;
    threads: number;
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(m3u8Path: string, {threads, output}?: DownloaderConfig);
    init(): Promise<void>;
}
export default Downloader;
