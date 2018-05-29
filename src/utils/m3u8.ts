const fs = require('fs');
import M3U8 from "../core/m3u8";
import Log from "./log";
import axios from 'axios';

export async function loadM3U8(path: string) {
    let m3u8Content;
    
    if (path.startsWith('http')) {
        Log.info('Start fetching M3U8 file.')
        try {
            const response = await axios.get(path);
            Log.info('M3U8 file fetched.');
            m3u8Content = response.data;
        } catch (e) {
            Log.error('Fail to fetch M3U8 file.')
        }
    } else {
        // is a local file path
        if (!fs.existsSync(path)) {
            Log.error(`File '${path}' not found.`);
        }
        Log.info('Loading M3U8 file.');
        m3u8Content = fs.readFileSync(path).toString();
    }
    return new M3U8(m3u8Content);
}