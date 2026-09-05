import { AxiosRequestConfig, AxiosResponse } from "axios";
import { DownloadSourceHttpClient } from "@/core/source/types";
import { DownloadHttpClient } from "./http_client";

/** Applies the configured source-attempt policy outside protocol implementations. */
export class RetryingSourceHttpClient implements DownloadSourceHttpClient {
    constructor(
        private readonly http: DownloadHttpClient,
        private readonly maxAttempts: number,
    ) {}

    get<T = any>(url: string, options: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
        return this.try(() => this.http.get<T>(url, options), options.signal);
    }

    request<T = any>(url: string, options: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
        return this.try(() => this.http.request<T>(url, options), options.signal);
    }

    private async try<T>(operation: () => Promise<T>, signal?: { readonly aborted: boolean }): Promise<T> {
        // `maxAttempts` includes the initial request, matching task-attempt semantics exactly.
        // Configuration normalization guarantees a positive attempt budget.
        for (let attempt = 1; ; attempt++) {
            try {
                return await operation();
            } catch (error) {
                // Cancellation is a lifecycle decision, never another source attempt.
                if (signal?.aborted || attempt >= this.maxAttempts) {
                    throw error;
                }
            }
        }
    }
}
