import M3U8 from "../core/m3u8";
import Logger from '../utils/log';
import { AxiosProxyConfig } from 'axios';
export declare function loadM3U8(Log: Logger, path: string, retries?: number, timeout?: number, proxy?: AxiosProxyConfig): Promise<M3U8>;
