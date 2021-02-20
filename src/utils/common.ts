import { URL } from "url";

class CommonUtils {
    static buildFullUrl(host: string, path: string) {
        if (path.startsWith("http")) {
            return path;
        } else if (path.startsWith("//")) {
            return new URL(host).protocol + path;
        } else if (path.startsWith("/")) {
            return host.match(/(htt(p|ps):\/\/.+?\/)/)[1] + path.slice(1);
        } else if (path.startsWith("./")) {
            const pathWithoutParams =
                new URL(host).origin + new URL(host).pathname;
            return `${pathWithoutParams
                .split("/")
                .slice(0, -1)
                .join("/")}/${path.slice(2)}`;
        } else {
            return host.match(/(.+\/)/)[1] + path;
        }
    }
}

export default CommonUtils;
