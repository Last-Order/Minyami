import * as fs from 'fs';
import Log from '../utils/log';
class Downloader {
    chunks: string[];
    constructor(path: string) {
        if (path.startsWith("http")) {
            // is a url
        } else {
            // is a local file path
            if (!fs.existsSync(path)) {
                Log.error(`File '${path}' not found.`);
            }
        }
    }
}

export default Downloader;