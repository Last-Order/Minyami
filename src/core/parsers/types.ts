import M3U8 from "../m3u8";
import { AxiosProxyConfig } from "axios";
import Downloader from "../downloader";

export interface ParserOptions {
    key?: string;
    iv?: string;
    options?: ParserAdditionalOptions;
    downloader?: Downloader;
}

export interface ParserAdditionalOptions {
    key?: string;
    m3u8Url?: string;
    m3u8?: M3U8;
    proxy?: AxiosProxyConfig;
    downloader?: Downloader;
}

export interface ParserResult {
    key?: string;
    iv?: string;
    prefix?: string;
    m3u8?: M3U8;
}