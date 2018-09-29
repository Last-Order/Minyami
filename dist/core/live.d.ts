import Downloader, { DownloaderConfig, Chunk } from "./downloader";
import M3U8 from "./m3u8";
import Logger from '../utils/log';
/**
 * Live Downloader
 */
export default class LiveDownloader extends Downloader {
    outputFileList: string[];
    finishedList: string[];
    m3u8: M3U8;
    playlists: M3U8[];
    chunks: Chunk[];
    runningThreads: number;
    isEncrypted: boolean;
    isEnd: boolean;
    isStarted: boolean;
    forceStop: boolean;
    prefix: string;
    retries: number;
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(log: Logger, m3u8Path: string, {threads, output, key, verbose, nomux, retries, proxy}?: DownloaderConfig);
    download(): Promise<void>;
    cycling(): Promise<void>;
    /**
     * 处理块下载任务
     * @override
     * @param task 块下载任务
     */
    handleTask(task: Chunk): Promise<{}>;
    checkQueue(): void;
}
