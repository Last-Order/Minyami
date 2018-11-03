import axios from "axios";
import { sleep as slp } from "../utils/system";

export type ActionType = 'ping' | 'sleep';

export async function ping(url) {
    const result = await axios.get(url, {
        headers:{
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36'
        }
    });
    return true;
}

export async function sleep(time) {
    await slp(parseInt(time));
    return true;
}