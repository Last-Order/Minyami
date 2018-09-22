import { exec } from './system';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { AxiosProxyConfig } from 'axios';
import * as fs from 'fs';
const SocksProxyAgent = require('socks-proxy-agent');

/**
 * 合并视频文件
 * @param fileList 文件列表
 * @param output 输出路径
 */
export async function mergeVideo(fileList = [], output = "./output.mkv") {
    if (fileList.length === 0) {
        return;
    }
    fileList = fileList.map((file, index) => {
        return index === 0 ? file : `+${file}`;
    });
    
    const parameters = fileList.concat([
        "-o",
        output,
        "-q"
    ]);

    const tempFilename = `temp_${new Date().valueOf()}.json`;
    fs.writeFileSync(`./${tempFilename}`, JSON.stringify(parameters));
    await exec(`mkvmerge @${tempFilename}`);
    fs.unlinkSync(`./${tempFilename}`);
}

export async function mergeVideoNew(fileList = [], output = "./output.ts") {
    if (fileList.length === 0) {
        return;
    }

    // create output file
    const fd = fs.openSync(output, 'w');
    fs.closeSync(fd);

    for (const file of fileList) {
        fs.appendFileSync(output, fs.readFileSync(file));
    }
}

/**
 * 下载文件
 * @param url 
 * @param path 
 */
export function download(url: string, path: string, proxy: AxiosProxyConfig = undefined) {
    return new Promise(async (resolve, reject) => {
        try {
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'arraybuffer',
                timeout: 60000,
                httpsAgent: proxy ? new SocksProxyAgent(`socks5://${proxy.host}:${proxy.port}`) : undefined,
                headers:{
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36'
                }
            });
            fs.writeFileSync(path, response.data);
            resolve();
        } catch (e) {
            reject(e);
        }
    })
}

/**
 * Raw Request
 * @param url 
 * @param proxy 
 */
export async function requestRaw(url: string, proxy: AxiosProxyConfig = undefined, options: AxiosRequestConfig = {}): Promise<AxiosResponse> {
    return await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: 60000,
        httpsAgent: proxy ? new SocksProxyAgent(`socks5://${proxy.host}:${proxy.port}`) : undefined,
        headers:{
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36'
        },
        ...options
    });
}
/**
 * 解密文件
 * @param input 
 * @param output 
 * @param key 
 * @param iv 
 */
export async function decrypt(input: string, output: string, key: string, iv: string) {
    return await exec(`openssl aes-128-cbc -d -in "${input}" -out "${output}" -K "${key}" -iv "${iv}"`);
}