import { describe, expect, jest, test } from "@jest/globals";
import { normalizeDownloaderConfig } from "@/core/download/config";
import { DownloadHttpClient } from "@/core/download/infrastructure/http_client";
import { RetryingSourceHttpClient } from "@/core/download/infrastructure/source_http_client";

describe("RetryingSourceHttpClient", () => {
    test.each([1, 3])("preserves the final request error after %i attempts", async (maxAttempts) => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const failure = new Error("source unavailable");
        const request = jest.spyOn(http, "request").mockRejectedValue(failure);
        const sourceHttp = new RetryingSourceHttpClient(http, maxAttempts);

        await expect(sourceHttp.request("https://example.com/key")).rejects.toBe(failure);
        expect(request).toHaveBeenCalledTimes(maxAttempts);
    });

    test("applies one consistent maximum-attempt policy outside sources", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const get = jest
            .spyOn(http, "get")
            .mockRejectedValueOnce(new Error("first failure"))
            .mockResolvedValueOnce({ data: "ok" } as any);
        const sourceHttp = new RetryingSourceHttpClient(http, 2);

        await expect(sourceHttp.get<string>("https://example.com/playlist.m3u8")).resolves.toMatchObject({
            data: "ok",
        });
        expect(get).toHaveBeenCalledTimes(2);
    });

    test("does not retry a cancelled source request", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const abort = new AbortController();
        const get = jest.spyOn(http, "get").mockImplementation(async () => {
            abort.abort();
            throw new Error("cancelled");
        });
        const sourceHttp = new RetryingSourceHttpClient(http, 5);

        await expect(sourceHttp.get("https://example.com/playlist.m3u8", { signal: abort.signal })).rejects.toThrow(
            "cancelled",
        );
        expect(get).toHaveBeenCalledTimes(1);
    });
});
