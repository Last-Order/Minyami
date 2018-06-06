import Downloader, { DownloaderConfig, Chunk } from "./downloader";
import M3U8 from "./m3u8";
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
    /**
     *
     * @param m3u8Path
     * @param config
     * @param config.threads 线程数量
     */
    constructor(m3u8Path: string, {threads, output, key, verbose}?: DownloaderConfig);
    download(): Promise<void>;
    cycling(): Promise<void>;
    checkQueue(): void;
}
