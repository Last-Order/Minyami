import Downloader, { DownloaderConfig } from "./downloader";
import M3U8 from "./m3u8";
export interface Chunk {
    url: string;
    filename: string;
}
/**
 * Live Downloader
 */
export default class LiveDownloader extends Downloader {
    outputFileList: string[];
    finishedList: string[];
    currentPlaylist: M3U8;
    playlists: M3U8[];
    chunks: Chunk[];
    runningThreads: number;
    finishedChunks: number;
    isEnd: boolean;
    isStarted: boolean;
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
    cycling(): Promise<void>;
    handleTask(task: Chunk): Promise<{}>;
    checkQueue(): void;
}
