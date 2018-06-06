const path = require('path');
const fs = require('fs');
import axios from 'axios';
import Log from "../utils/log";
import M3U8 from "./m3u8";
import { loadM3U8 } from '../utils/m3u8';
import { download, decrypt } from '../utils/media';

export interface DownloaderConfig {
    threads?: number;
    output?: string;
    key?: string;
    verbose?: boolean;
}

export interface Chunk {
    url: string;
    filename: string;
}

class Downloader {
    tempPath: string;
    m3u8Path: string;
    m3u8: M3U8;
    outputPath: string = './output.mkv';
    threads: number = 5;

    key: string;
    iv: string;

    verbose: boolean = false;

    startedAt: number;
    finishedChunks: number = 0;

    /**
     * 
     * @param m3u8Path 
     * @param config
     * @param config.threads 线程数量 
     */
    constructor(m3u8Path: string, { threads, output, key, verbose }: DownloaderConfig = {
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

        if (verbose) {
            this.verbose = verbose;
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

    handleTask(task: Chunk) {
        return new Promise(async (resolve, reject) => {
            this.verbose && Log.debug(`Downloading ${task.filename}`);
            try {
                await download(task.url, path.resolve(this.tempPath, `./${task.filename}`));
                this.verbose && Log.debug(`Downloading ${task.filename} succeed.`);
                if (this.m3u8.isEncrypted) {
                    await decrypt(path.resolve(this.tempPath, `./${task.filename}`), path.resolve(this.tempPath, `./${task.filename}`) + '.decrypt', this.key, this.iv);
                    this.verbose && Log.debug(`Decrypting ${task.filename} succeed`);
                }
                resolve();
            } catch (e) {
                Log.info(`Downloading or decrypting ${task.filename} failed. Retry later.`);
                reject(e);
            }            
        });
    }


    calculateSpeedByChunk() {
        return (this.finishedChunks / Math.round((new Date().valueOf() - this.startedAt) / 1000)).toFixed(2);
    }

    calculateSpeedByRatio() {
        return (this.finishedChunks * this.m3u8.getChunkLength() / Math.round((new Date().valueOf() - this.startedAt) / 1000)).toFixed(2);
    }
};

export default Downloader;