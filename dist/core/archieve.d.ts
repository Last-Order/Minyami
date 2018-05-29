import Downloader from './base';
export interface DownloaderConfig {
    threads?: number;
    output?: string;
}
export interface Chunk {
    url: string;
    filename: string;
}
export default Downloader;
