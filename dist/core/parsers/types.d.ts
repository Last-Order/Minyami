import M3U8 from "../m3u8";
import { AxiosProxyConfig } from "axios";
export interface ParserOptions {
    key?: string;
    iv?: string;
    options?: ParserAdditionalOptions;
}
export interface ParserAdditionalOptions {
    key?: string;
    m3u8Url?: string;
    m3u8?: M3U8;
    proxy?: AxiosProxyConfig;
}
export interface ParserResult {
    key: string;
    iv: string;
    prefix: string;
    m3u8?: M3U8;
}
