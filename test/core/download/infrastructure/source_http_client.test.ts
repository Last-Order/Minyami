import { describe, expect, jest, test } from "@jest/globals";
import { normalizeDownloaderConfig } from "../../../../src/core/download/config";
import { DownloadHttpClient } from "../../../../src/core/download/infrastructure/http_client";
import { RetryingSourceHttpClient } from "../../../../src/core/download/infrastructure/source_http_client";

describe("RetryingSourceHttpClient", () => {
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

    test("does not perform an extra initial attempt beyond the configured maximum", async () => {
        const http = new DownloadHttpClient(normalizeDownloaderConfig());
        const get = jest.spyOn(http, "get").mockRejectedValue(new Error("unavailable"));
        const sourceHttp = new RetryingSourceHttpClient(http, 2);

        await expect(sourceHttp.get("https://example.com/playlist.m3u8")).rejects.toThrow("unavailable");
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
            "cancelled"
        );
        expect(get).toHaveBeenCalledTimes(1);
    });
});
