import { exec } from './system';
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