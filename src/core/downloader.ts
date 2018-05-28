const path = require('path');
const fs = require('fs');
import axios from 'axios';
import Log from "../utils/log";
import M3U8 from "./m3u8";

export interface DownloaderConfig {
    threads?: number;
    output?: string;
    key?: string;
}

class Downloader {
    tempPath: any;
    m3u8Path: string;
    m3u8: M3U8;
    outputPath: string;
    threads: number;
    key: string;
    /**
     * 
     * @param m3u8Path 
     * @param config
     * @param config.threads 线程数量 
     */
    constructor(m3u8Path: string, { threads, output, key }: DownloaderConfig = {
        threads: 5
    }) {
        if (threads) {
            this.threads = threads;
        }

        if (output) {
            this.outputPath = output;
        }

        if (key) {
            this.key = key;
        }
      
        this.m3u8Path = m3u8Path;
        this.tempPath = path.resolve(__dirname, '../../temp');
    }

    async init() {
        let m3u8Content;
        if (!fs.existsSync(this.tempPath)) {
            fs.mkdirSync(this.tempPath);
        }
        if (this.m3u8Path.startsWith('http')) {
            Log.info('Start fetching M3U8 file.')
            try {
                const response = await axios.get(this.m3u8Path);
                Log.info('M3U8 file fetched.');
                m3u8Content = response.data;
            } catch (e) {
                Log.error('Fail to fetch M3U8 file.')
            }
        } else {
            // is a local file path
            if (!fs.existsSync(this.m3u8Path)) {
                Log.error(`File '${this.m3u8Path}' not found.`);
            }
            Log.info('Loading M3U8 file.');
            m3u8Content = fs.readFileSync(this.m3u8Path).toString();
        }

        this.m3u8 = new M3U8(m3u8Content);
    }
};

export default Downloader;