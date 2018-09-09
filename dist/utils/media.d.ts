import { AxiosProxyConfig } from 'axios';
/**
 * 合并视频文件
 * @param fileList 文件列表
 * @param output 输出路径
 */
export declare function mergeVideo(fileList?: any[], output?: string): Promise<void>;
export declare function mergeVideoNew(fileList?: any[], output?: string): Promise<void>;
/**
 * 下载文件
 * @param url
 * @param path
 */
export declare function download(url: string, path: string, proxy?: AxiosProxyConfig): Promise<{}>;
/**
 * 解密文件
 * @param input
 * @param output
 * @param key
 * @param iv
 */
export declare function decrypt(input: string, output: string, key: string, iv: string): Promise<any>;
