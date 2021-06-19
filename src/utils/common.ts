import { URL } from "url";

class CommonUtils {
    static buildFullUrl(host: string, path: string) {
        if (path.startsWith("http")) {
            return path;
        }
        return new URL(path, host).href;
    }
}

export default CommonUtils;
