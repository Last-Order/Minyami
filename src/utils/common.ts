import * as fs from "fs";

export function getAvailableOutputPath(path: string) {
    const pathArr = path.split(".");
    const filePath = pathArr.slice(0, -1).join(".");
    const ext = pathArr[pathArr.length - 1];
    if (fs.existsSync(path) || fs.existsSync(`${filePath}_0.${ext}`)) {
        // output filename conflict
        return `${filePath}_${Date.now()}.${ext}`;
    }
    return path;
}
