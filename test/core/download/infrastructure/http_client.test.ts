import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { gzipSync } from "zlib";
import { describe, expect, test } from "@jest/globals";
import axios from "axios";
import { normalizeDownloaderConfig } from "@/core/download/config";
import { DownloadHttpClient } from "@/core/download/infrastructure/http_client";
import { withTempDirectory } from "../../../helpers/filesystem";
import { close, listen } from "../../../helpers/http";

describe("DownloadHttpClient", () => {
    test("keeps configured headers on its isolated Axios instance", () => {
        const globalHeader = axios.defaults.headers.common["X-Minyami-Test"];
        const client = new DownloadHttpClient(
            normalizeDownloaderConfig({
                headers: "X-Minyami-Test: isolated",
            }),
        );

        expect(client.axios.defaults.headers["X-Minyami-Test"]).toBe("isolated");
        expect(axios.defaults.headers.common["X-Minyami-Test"]).toBe(globalHeader);
    });

    test("rejects Content-Length: 0 before publishing a file", async () => {
        const server = http.createServer((_request, response) => {
            response.setHeader("content-length", 0);
            response.end();
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-http-empty-", async (directory) => {
                const destination = path.join(directory, "chunk.bin");
                const client = new DownloadHttpClient(normalizeDownloaderConfig());

                await expect(client.download(`${baseUrl}/chunk`, destination)).rejects.toThrow(
                    "Downloaded response body is empty.",
                );
                expect(fs.readdirSync(directory)).toEqual([]);
            });
        } finally {
            await close(server);
        }
    });

    test("downloads gzip content using the decoded body rather than the encoded Content-Length", async () => {
        const resource = Buffer.from("media-chunk".repeat(100));
        const encoded = gzipSync(resource);
        const server = http.createServer((_request, response) => {
            response.setHeader("content-encoding", "gzip");
            response.setHeader("content-length", encoded.length);
            response.end(encoded);
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-http-gzip-", async (directory) => {
                const destination = path.join(directory, "chunk.bin");
                const client = new DownloadHttpClient(normalizeDownloaderConfig());

                await client.download(`${baseUrl}/chunk`, destination);

                expect(fs.readFileSync(destination)).toEqual(resource);
                expect(fs.readdirSync(directory)).toEqual(["chunk.bin"]);
            });
        } finally {
            await close(server);
        }
    });

    test.each(["content-length", "chunked"])(
        "rejects a truncated %s response without publishing a partial file",
        async (framing) => {
            const server = http.createServer((_request, response) => {
                if (framing === "content-length") {
                    response.setHeader("content-length", 1000);
                } else {
                    response.setHeader("transfer-encoding", "chunked");
                }
                // Flush partial data before disconnecting, without sending a complete HTTP response.
                response.write(Buffer.alloc(100), () => response.destroy());
            });
            const baseUrl = await listen(server);

            try {
                await withTempDirectory("minyami-http-truncated-", async (directory) => {
                    const destination = path.join(directory, "chunk.bin");
                    const client = new DownloadHttpClient(normalizeDownloaderConfig());

                    await expect(client.download(`${baseUrl}/chunk`, destination)).rejects.toMatchObject({
                        code: "ERR_BAD_RESPONSE",
                    });
                    expect(fs.readdirSync(directory)).toEqual([]);
                });
            } finally {
                await close(server);
            }
        },
    );

    test("downloads an exact 206 byte range", async () => {
        const resource = Buffer.from("0123456789");
        let receivedRange: string | undefined;
        let receivedEncoding: string | undefined;
        const server = http.createServer((request, response) => {
            receivedRange = request.headers.range;
            receivedEncoding = request.headers["accept-encoding"];
            response.statusCode = 206;
            response.setHeader("content-range", "bytes 2-5/10");
            response.setHeader("content-length", 4);
            response.end(resource.subarray(2, 6));
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-http-range-", async (directory) => {
                const destination = path.join(directory, "range.bin");
                const client = new DownloadHttpClient(normalizeDownloaderConfig());

                await client.download(`${baseUrl}/resource`, destination, {
                    byteRange: { offset: 2, length: 4 },
                });

                expect(receivedRange).toBe("bytes=2-5");
                expect(receivedEncoding).toBe("identity");
                expect(fs.readFileSync(destination)).toEqual(Buffer.from("2345"));
            });
        } finally {
            await close(server);
        }
    });

    test("rejects a full response when the server ignores Range", async () => {
        const resource = Buffer.from("0123456789");
        const server = http.createServer((_request, response) => {
            response.setHeader("content-length", resource.length);
            response.end(resource);
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-http-range-fallback-", async (directory) => {
                const destination = path.join(directory, "range.bin");
                const client = new DownloadHttpClient(normalizeDownloaderConfig());

                await expect(
                    client.download(`${baseUrl}/resource`, destination, {
                        byteRange: { offset: 6, length: 3 },
                    }),
                ).rejects.toThrow("Unexpected response status for byte-range request: 200");
                expect(fs.existsSync(destination)).toBe(false);
            });
        } finally {
            await close(server);
        }
    });

    test.each([
        ["a missing Content-Range", undefined],
        ["a mismatched Content-Range", "bytes 1-4/10"],
    ])("accepts a correctly sized 206 response with %s", async (_name, contentRange) => {
        const server = http.createServer((_request, response) => {
            response.statusCode = 206;
            if (contentRange) {
                response.setHeader("content-range", contentRange);
            }
            response.end("2345");
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-http-invalid-range-", async (directory) => {
                const destination = path.join(directory, "range.bin");
                const client = new DownloadHttpClient(normalizeDownloaderConfig());

                await client.download(`${baseUrl}/resource`, destination, {
                    byteRange: { offset: 2, length: 4 },
                });
                expect(fs.readFileSync(destination)).toEqual(Buffer.from("2345"));
            });
        } finally {
            await close(server);
        }
    });

    test("rejects a 206 response whose body size differs from the requested byte range", async () => {
        const server = http.createServer((_request, response) => {
            response.statusCode = 206;
            response.end("too short");
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-http-wrong-range-size-", async (directory) => {
                const destination = path.join(directory, "range.bin");
                const client = new DownloadHttpClient(normalizeDownloaderConfig());

                await expect(
                    client.download(`${baseUrl}/resource`, destination, {
                        byteRange: { offset: 2, length: 4 },
                    }),
                ).rejects.toThrow("Downloaded byte count does not match the requested byte range");
                expect(fs.existsSync(destination)).toBe(false);
            });
        } finally {
            await close(server);
        }
    });
});
