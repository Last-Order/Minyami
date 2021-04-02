import { URL } from "url";

class CommonUtils {
    static buildFullUrl(host: string, path: string) {
        return new URL(path, host).href;
    }
}

export default CommonUtils;
