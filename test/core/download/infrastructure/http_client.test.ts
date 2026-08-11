import { describe, expect, test } from "@jest/globals";
import axios from "axios";
import { normalizeDownloaderConfig } from "../../../../src/core/download/config";
import { DownloadHttpClient } from "../../../../src/core/download/infrastructure/http_client";

describe("DownloadHttpClient", () => {
    test("keeps configured headers on its isolated Axios instance", () => {
        const globalHeader = axios.defaults.headers.common["X-Minyami-Test"];
        const client = new DownloadHttpClient(
            normalizeDownloaderConfig({
                headers: "X-Minyami-Test: isolated",
            })
        );

        expect(client.axios.defaults.headers["X-Minyami-Test"]).toBe("isolated");
        expect(axios.defaults.headers.common["X-Minyami-Test"]).toBe(globalHeader);
    });
});
