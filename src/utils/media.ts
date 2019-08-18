import { exec } from './system';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { AxiosProxyConfig } from 'axios';
import * as fs from 'fs';
import UA from './ua';
import { URL } from 'url';
const SocksProxyAgent = require('socks-proxy-agent');

/**
 * 合并视频文件
 * @param fileList 文件列表
 * @param output 输出路径
 */
export function mergeToMKV(fileList = [], output = "./output.mkv") {
    return new Promise(async (resolve) => {
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
        fs.writeFileSync(`./${tempFilename}`, JSON.stringify(parameters, null, 2));
        await exec(`mkvmerge @${tempFilename}`);
        fs.unlinkSync(`./${tempFilename}`);
        resolve();
    });
}

export function mergeToTS(fileList = [], output = "./output.ts") {
    return new Promise(async (resolve) => {
        if (fileList.length === 0) {
            resolve();
        }

        const writeStream = fs.createWriteStream(output);
        const lastIndex = fileList.length - 1;
        let i = 0;
        let writable = true;
        write();
        function write() {
            writable = true;
            while (i <= lastIndex && writable) {
                writable = writeStream.write(fs.readFileSync(fileList[i]), () => {
                    if (i > lastIndex) {
                        resolve();
                    }
                });
                i++;
            }
            if (i <= lastIndex) {
                writeStream.once('drain', () => {
                    write();
                });
            }
        }
    })
}

/**
 * 下载文件
 * @param url 
 * @param path 
 */
export function download(url: string, path: string, proxy: AxiosProxyConfig = undefined, options: AxiosRequestConfig = {}) {
    const CancelToken = axios.CancelToken;
    let source = CancelToken.source();
    const promise = new Promise(async (resolve, reject) => {
        try {
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'arraybuffer',
                httpsAgent: proxy ? new SocksProxyAgent(`socks5h://${proxy.host}:${proxy.port}`) : undefined,
                headers: {
                    'User-Agent': UA.CHROME_DEFAULT_UA,
                    'Host': new URL(url).host
                },
                cancelToken: source.token,
                ...options,
            });
            fs.writeFileSync(path, response.data);
            resolve();
        } catch (e) {
            reject(e);
        } finally {
            source = null;
        }
    });
    const timeout = new Promise((resolve, reject) => {
        setTimeout(() => {
            reject('Timeout');
            source && source.cancel('Cancel');
        }, options.timeout || 60000);
    })
    return Promise.race([
        promise,
        timeout
    ]);
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
        httpsAgent: proxy ? new SocksProxyAgent(`socks5h://${proxy.host}:${proxy.port}`) : undefined,
        headers: {
            'User-Agent': UA.CHROME_DEFAULT_UA,
            'Host': new URL(url).host
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