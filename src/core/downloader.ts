const path = require('path');
const fs = require('fs');
import axios from 'axios';
import Log from "../utils/log";
import M3U8 from "./m3u8";
import { loadM3U8 } from '../utils/m3u8';

export interface DownloaderConfig {
    threads?: number;
    output?: string;
    key?: string;
}

class Downloader {
    tempPath: string;
    m3u8Path: string;
    m3u8: M3U8;
    outputPath: string = './output.mkv';
    threads: number = 5;
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
        if (!fs.existsSync(this.tempPath)) {
            fs.mkdirSync(this.tempPath);
        }
        this.m3u8 = await loadM3U8(this.m3u8Path);
    }
};

export default Downloader;