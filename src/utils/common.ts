import { URL } from "url";
import * as fs from "fs";

export function buildFullUrl(host: string, path: string) {
    if (path.startsWith("http")) {
        return path;
    }
    return new URL(path, host).href;
}

export function getAvailableOutputPath(path: string) {
    if (fs.existsSync(path)) {
        // output filename conflict
        const pathArr = path.split(".");
        const filePath = pathArr.slice(0, -1).join(".");
        const ext = pathArr[pathArr.length - 1];
        return `${filePath}_${Date.now()}.${ext}`;
    }
    return path;
}

/** 获得文件后缀名 */
export function getFileExt(filePath: string): string {
    let ext = "";
    if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
        const urlPath = new URL(filePath).pathname.slice(1).split("/");
        if (urlPath[urlPath.length - 1].includes(".")) {
            ext = urlPath[urlPath.length - 1].split(".").slice(-1)[0];
        }
    } else {
        const filePathArr = filePath.split("/");
        const filename = filePathArr[filePathArr.length - 1];
        ext = filename.includes(".") ? filename.split(".").slice(-1)[0] : "";
    }
    return ext;
}
