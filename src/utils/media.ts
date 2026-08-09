import * as fs from "fs";
import { URL } from "url";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { exec } from "./system";
import { getAvailableOutputPath } from "./common";
import ProxyAgentHelper from "./agent";

/**
 * 合并视频文件
 * @param fileList 文件列表
 * @param output 输出路径
 */
export function mergeToMKV(fileList = [], output = "./output.mkv") {
    const outputPath = getAvailableOutputPath(output);
    return new Promise<string>(async (resolve) => {
        if (fileList.length === 0) {
            return;
        }
        fileList = fileList.map((file, index) => {
            return index === 0 ? file : `+${file}`;
        });

        const parameters = fileList.concat(["-o", outputPath, "-q"]);

        const tempFilename = `temp_${new Date().valueOf()}.json`;
        fs.writeFileSync(`./${tempFilename}`, JSON.stringify(parameters, null, 2));
        await exec(`mkvmerge @${tempFilename}`);
        fs.unlinkSync(`./${tempFilename}`);
        resolve(outputPath);
    });
}

export function mergeToTS(fileList = [], output = "./output.ts") {
    const cliProgress = require("cli-progress");
    const outputPath = getAvailableOutputPath(output);
    return new Promise<string>(async (resolve) => {
        if (fileList.length === 0) {
            resolve(outputPath);
        }

        const writeStream = fs.createWriteStream(outputPath);
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
                        resolve(outputPath);
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
                    ...(!axios.defaults.headers.common["Host"] ? { Host: new URL(url).host } : {}),
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
            const tempPath = path + ".t";
            fs.writeFileSync(tempPath, response.data);
            fs.renameSync(tempPath, path);
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
export async function requestRaw(url: string, options: AxiosRequestConfig = {}): Promise<AxiosResponse> {
    const proxyAgentInstance = ProxyAgentHelper.getProxyAgentInstance();
    return await axios({
        url,
        method: "GET",
        responseType: "stream",
        timeout: 60000,
        httpsAgent: proxyAgentInstance ? proxyAgentInstance : undefined,
        headers: {
            Host: new URL(url).host,
        },
        ...options,
    });
}
