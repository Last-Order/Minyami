import { exec } from './system';
import axios from 'axios';
const fs = require('fs');

/**
 * 合并视频文件
 * @param fileList 文件列表
 * @param output 输出路径
 */
export async function mergeVideo(fileList = [], output = "output.mkv") {
    if (fileList.length === 0) {
        return;
    }
    const parameters = fileList.concat([
        "-o",
        output
    ]);

    fs.writeFileSync('./temp.json', JSON.stringify(parameters));

    await exec('mkvmerge @temp.json');

    fs.unlinkSync('./temp.json');
}

/**
 * 下载文件
 * @param url 
 * @param path 
 */
export function download(url: string, path: string) {
    return new Promise(async (resolve, reject) => {
        try {
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
            });
            response.data.pipe(fs.createWriteStream(path));
            response.data.on('end', () => {
                resolve();
            })
        } catch (e) {
            reject(e);
        }
    })
}
/**
 * 解密文件
 * @param input 
 * @param output 
 * @param key 
 * @param iv 
 */
export async function decrypt(input: string, output: string, key: string, iv: string) {
    return await exec(`openssl aes-128-cbc -d -in '${input}' -out '${output}' -K "${key}" -iv "${iv}"`);
}