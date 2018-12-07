class CommonUtils {
    static buildFullUrl(host: string, path: string) {
        if (path.startsWith('http')) {
            return path;
        } else if (path.startsWith('/')) {
            return host.match(/(htt(p|ps):\/\/.+?\/)/)[1] + path.slice(1);
        } else {
            return host.match(/(.+\/)/)[1] + path;
        }
    }
}

export default CommonUtils;