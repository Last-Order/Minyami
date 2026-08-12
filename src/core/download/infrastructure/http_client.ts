import * as fs from "fs";
import { URL } from "url";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { Agent } from "agent-base";
import UA from "../../../constants/ua";
import { createTimedAbortScope } from "../../../utils/abort";
import ProxyAgentHelper, { createProxyAgent } from "../../../utils/agent";

export interface DownloadHttpClientConfig {
    readonly proxy: string;
    readonly cookies?: string;
    readonly headers: Readonly<Record<string, string>>;
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
        const timeout = options.timeout || 60000;
        // Keep a local timeout guard because some adapters do not abort stalled response bodies consistently.
        const abortScope = createTimedAbortScope(timeout, options.signal);

        try {
            const response = await this.request<ArrayBuffer>(url, {
                responseType: "arraybuffer",
                ...options,
                signal: abortScope.signal,
            });
            const body = Buffer.from(response.data);
            const contentLength = response.headers["content-length"];
            if (contentLength && parseInt(String(contentLength)) !== body.length) {
                throw new Error("Bad Response");
            }
            // Publish by rename so executors never observe a partially written destination as a successful item.
            const temporaryPath = destination + ".t";
            fs.writeFileSync(temporaryPath, body);
            fs.renameSync(temporaryPath, destination);
        } finally {
            abortScope.dispose();
        }
    }
}
