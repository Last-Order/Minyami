import * as fs from "fs";
import { URL } from "url";
import { Agent } from "agent-base";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import UA from "@/constants/ua";
import { DownloadByteRange } from "@/core/source/types";
import { createTimedAbortScope, getOptionalAbortSignal } from "@/utils/abort";
import ProxyAgentHelper, { createProxyAgent } from "@/utils/agent";

export interface DownloadHttpClientConfig {
    readonly proxy: string;
    readonly cookies?: string;
    readonly headers: Readonly<Record<string, string>>;
}

export interface DownloadRequestConfig extends AxiosRequestConfig {
    readonly byteRange?: DownloadByteRange;
}

export interface DownloadTransfer {
    readonly bytes: number;
    readonly startedAt: number;
    readonly completedAt: number;
}

export class DownloadHttpClient {
    readonly axios: AxiosInstance;
    readonly agent: Agent | undefined;
    private readonly hasExplicitHostHeader: boolean;

    constructor(config: DownloadHttpClientConfig) {
        this.agent = config.proxy
            ? createProxyAgent(config.proxy, { allowNonPrefixSocksProxy: true })
            : ProxyAgentHelper.getProxyAgentInstance();
        this.hasExplicitHostHeader = Object.keys(config.headers).some((header) => header.toLowerCase() === "host");
        this.axios = axios.create({
            headers: {
                "User-Agent": UA.CHROME_DEFAULT_UA,
                ...(config.cookies ? { Cookie: config.cookies } : {}),
                ...config.headers,
            },
            proxy: false,
            httpAgent: this.agent,
            httpsAgent: this.agent,
        });
    }

    private hostHeader(url: string): Record<string, string> {
        // Redirected/media hosts need their own authority unless the caller intentionally pinned Host.
        return this.hasExplicitHostHeader ? {} : { Host: new URL(url).host };
    }

    get<T = any>(url: string, options: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
        return this.axios.get<T>(url, {
            ...options,
            headers: {
                ...this.hostHeader(url),
                ...options.headers,
            },
        });
    }

    request<T = any>(url: string, options: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
        return this.axios.request<T>({
            url,
            method: "GET",
            ...options,
            headers: {
                ...this.hostHeader(url),
                ...options.headers,
            },
        });
    }

    async download(url: string, destination: string, options: DownloadRequestConfig = {}): Promise<DownloadTransfer> {
        const { byteRange, ...requestOptions } = options;
        const timeout = requestOptions.timeout || 60000;
        // Keep a local timeout guard because some adapters do not abort stalled response bodies consistently.
        const abortScope = createTimedAbortScope(timeout, requestOptions.signal ?? getOptionalAbortSignal());
        const startedAt = performance.now();

        try {
            const response = await this.request<ArrayBuffer>(url, {
                responseType: "arraybuffer",
                ...requestOptions,
                ...(byteRange
                    ? {
                          headers: {
                              ...requestOptions.headers,
                              Range: `bytes=${byteRange.offset}-${byteRange.offset + byteRange.length - 1}`,
                              "Accept-Encoding": "identity",
                          },
                      }
                    : {}),
                signal: abortScope.signal,
            });
            // Disk writes and decryption must not extend the measured network transfer interval.
            const completedAt = performance.now();
            // The Node adapter already returns a Buffer; reuse it rather than copying a complete chunk.
            const body = Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
            // Empty chunks must retry instead of being admitted as successful output.
            if (body.length === 0) {
                throw new Error("Downloaded response body is empty.");
            }
            // Axios rejects truncated HTTP responses before resolving. Content-Length describes the
            // encoded body, so comparing it with Axios's decoded data would reject valid compressed chunks.
            if (byteRange) {
                if (response.status !== 206) {
                    throw new Error(`Unexpected response status for byte-range request: ${response.status}`);
                }
                if (body.length !== byteRange.length) {
                    throw new Error("Downloaded byte count does not match the requested byte range.");
                }
            }
            // Publish by rename so executors never observe a partially written destination as a successful item.
            const temporaryPath = destination + ".t";
            await fs.promises.writeFile(temporaryPath, body, { signal: abortScope.signal });
            // Cancellation may arrive during asynchronous disk I/O, before the complete file is published.
            abortScope.signal.throwIfAborted();
            await fs.promises.rename(temporaryPath, destination);
            const contentLength = response.headers["content-length"];
            const encodedBytes =
                typeof contentLength === "number"
                    ? contentLength
                    : typeof contentLength === "string" && /^\d+$/.test(contentLength)
                      ? Number(contentLength)
                      : NaN;
            // Content-Length survives Axios decompression; without it, the decoded chunk size is an estimate.
            return {
                bytes: Number.isSafeInteger(encodedBytes) && encodedBytes > 0 ? encodedBytes : body.length,
                startedAt,
                completedAt,
            };
        } finally {
            abortScope.dispose();
        }
    }
}
