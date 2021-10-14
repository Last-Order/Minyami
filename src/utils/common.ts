import { URL } from "url";
import * as fs from "fs";

class CommonUtils {
    static buildFullUrl(host: string, path: string) {
        if (path.startsWith("http")) {
            return path;
        }
        return new URL(path, host).href;
    }
    static getAvailableOutputPath(path: string) {
        if (fs.existsSync(path)) {
            // output filename conflict
            const pathArr = path.split(".");
            const filePath = pathArr.slice(0, -1).join(".");
            const ext = pathArr[pathArr.length - 1];
            return `${filePath}_${Date.now()}.${ext}`;
        }
        return path;
    }
}

export default CommonUtils;
