import * as fs from "fs";
import { URL } from "url";
import * as crypto from "crypto";
import { SocksProxyAgent } from "socks-proxy-agent";
import axios, { AxiosRequestConfig, AxiosResponse, AxiosProxyConfig } from "axios";
import { exec } from "./system";
import ProxyAgentHelper from "../utils/agent";
import UA from "../constants/ua";

/**
 * 合并视频文件
 * @param fileList 文件列表
 * @param output 输出路径
 */
export function mergeToMKV(fileList = [], output = "./output.mkv") {
    return new Promise<void>(async (resolve) => {
        if (fileList.length === 0) {
            return;
        }
        fileList = fileList.map((file, index) => {
            return index === 0 ? file : `+${file}`;
        });

        const parameters = fileList.concat(["-o", output, "-q"]);

        const tempFilename = `temp_${new Date().valueOf()}.json`;
        fs.writeFileSync(`./${tempFilename}`, JSON.stringify(parameters, null, 2));
        await exec(`mkvmerge @${tempFilename}`);
        fs.unlinkSync(`./${tempFilename}`);
        resolve();
    });
}

export function mergeToTS(fileList = [], output = "./output.ts") {
    const cliProgress = require("cli-progress");
    return new Promise<void>(async (resolve) => {
        if (fileList.length === 0) {
            resolve();
        }

        const writeStream = fs.createWriteStream(output);
        const lastIndex = fileList.length - 1;
        const bar = new cliProgress.SingleBar(
            {
                format: "[MINYAMI][MERGING] [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}",
            },
            cliProgress.Presets.shades_classic
        );
        bar.start(fileList.length, 0);
        let i = 0;
        let writable = true;
        write();
        function write() {
            writable = true;
            while (i <= lastIndex && writable) {
                writable = writeStream.write(fs.readFileSync(fileList[i]), () => {
                    if (i > lastIndex) {
                        bar.update(i);
                        bar.stop();
                        writeStream.end();
                        resolve();
                    }
                });
                bar.update(i);
                i++;
            }
            if (i <= lastIndex) {
                writeStream.once("drain", () => {
                    write();
                });
            }
        }
    });
}

/**
 * 下载文件
 * @param url
 * @param path
 */
export function download(url: string, path: string, options: AxiosRequestConfig = {}) {
    const CancelToken = axios.CancelToken;
    let source = CancelToken.source();
    const promise = new Promise<void>(async (resolve, reject) => {
        try {
            setTimeout(() => {
                source && source.cancel();
                source = null;
            }, options.timeout || 60000);
            const proxyAgentInstance = ProxyAgentHelper.getProxyAgentInstance();
            const response = await axios({
                url,
                method: "GET",
                responseType: "arraybuffer",
                httpsAgent: proxyAgentInstance ? proxyAgentInstance : undefined,
                headers: {
                    "User-Agent": UA.CHROME_DEFAULT_UA,
                    Host: new URL(url).host,
                },
                cancelToken: source.token,
                ...options,
            });
            if (
                response.headers["content-length"] &&
                parseInt(response.headers["content-length"]) !== response.data.length
            ) {
                reject(new Error("Bad Response"));
            }
            fs.writeFileSync(path, response.data);
            resolve();
        } catch (e) {
            reject(e);
        } finally {
            source = null;
        }
    });
    return promise;
}

/**
 * Raw Request
 * @param url
 * @param proxy
 */
export async function requestRaw(
    url: string,
    options: AxiosRequestConfig = {}
): Promise<AxiosResponse> {
    const proxyAgentInstance = ProxyAgentHelper.getProxyAgentInstance();
    return await axios({
        url,
        method: "GET",
        responseType: "stream",
        timeout: 60000,
        httpsAgent: proxyAgentInstance ? proxyAgentInstance : undefined,
        headers: {
            "User-Agent": UA.CHROME_DEFAULT_UA,
            Host: new URL(url).host,
        },
        ...options,
    });
}
/**
 * 解密文件
 * @param input
 * @param output
 * @param key in hex
 * @param iv in hex
 */
export function decrypt(input: string, output: string, key: string, iv: string) {
    return new Promise((resolve) => {
        const algorithm = "aes-128-cbc";
        if (key.length !== 32) {
            throw new Error(`Key [${key}] length [${key.length}] or form invalid.`);
        }
        if (iv.length > 32) {
            throw new Error(`IV [${iv}] length [${iv.length}] or form invalid.`);
        }
        if (iv.length % 2 == 1) {
            iv = "0" + iv;
        }
        const keyBuffer = Buffer.alloc(16);
        const ivBuffer = Buffer.alloc(16);
        keyBuffer.write(key, "hex");
        ivBuffer.write(iv, 16 - iv.length / 2, "hex");

        const decipher = crypto.createDecipheriv(algorithm, keyBuffer, ivBuffer);
        const i = fs.createReadStream(input);
        const o = fs.createWriteStream(output);
        const pipe = i.pipe(decipher).pipe(o);
        pipe.on("finish", resolve);
    });
}
