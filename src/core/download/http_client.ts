import * as fs from "fs";
import { URL } from "url";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { Agent } from "agent-base";
import UA from "../../constants/ua";
import ProxyAgentHelper, { createProxyAgent } from "../../utils/agent";
import { NormalizedDownloaderConfig } from "./config";

export class DownloadHttpClient {
    readonly axios: AxiosInstance;
    readonly agent: Agent;
    private readonly hasExplicitHostHeader: boolean;

    constructor(config: NormalizedDownloaderConfig) {
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
            httpAgent: this.agent || undefined,
            httpsAgent: this.agent || undefined,
        });
    }

    private hostHeader(url: string): Record<string, string> {
        return this.hasExplicitHostHeader ? {} : { Host: new URL(url).host };
    }

    get<T = any>(url: string, options: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
        return this.axios.get<T>(url, {
            ...options,
            headers: {
                ...this.hostHeader(url),
                ...(options.headers || {}),
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
                ...(options.headers || {}),
            },
        });
    }

    async download(url: string, destination: string, options: AxiosRequestConfig = {}): Promise<void> {
        const cancelSource = axios.CancelToken.source();
        const timeout = options.timeout || 60000;
        const timeoutId = setTimeout(() => cancelSource.cancel(), timeout);

        try {
            const response = await this.request<ArrayBuffer>(url, {
                responseType: "arraybuffer",
                cancelToken: cancelSource.token,
                ...options,
            });
            const body = Buffer.from(response.data);
            const contentLength = response.headers["content-length"];
            if (contentLength && parseInt(contentLength) !== body.length) {
                throw new Error("Bad Response");
            }
            const temporaryPath = destination + ".t";
            fs.writeFileSync(temporaryPath, body);
            fs.renameSync(temporaryPath, destination);
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
