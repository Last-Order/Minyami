import M3U8 from "../core/m3u8";
import { AxiosProxyConfig } from 'axios';
export declare function loadM3U8(path: string, retries?: number, timeout?: number, proxy?: AxiosProxyConfig): Promise<M3U8>;
