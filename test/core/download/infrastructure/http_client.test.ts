import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { gzipSync } from "zlib";
import { describe, expect, jest, test } from "@jest/globals";
import axios, { AxiosAdapter } from "axios";
import { normalizeDownloaderConfig } from "@/core/download/config";
import { DownloadHttpClient } from "@/core/download/infrastructure/http_client";
import { withTempDirectory } from "../../../helpers/filesystem";
import { close, listen } from "../../../helpers/http";

function respondWith(data: Buffer | ArrayBuffer): AxiosAdapter {
    return async (config) => ({ data, status: 200, statusText: "OK", headers: {}, config });
}

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

    test.each([
        { kind: "Buffer", data: Buffer.from("complete downloaded chunk") },
        { kind: "ArrayBuffer", data: Uint8Array.from(Buffer.from("complete downloaded chunk")).buffer },
    ])("publishes a $kind response only after its pending disk write succeeds", async ({ data }) => {
        const clock = jest.spyOn(performance, "now").mockReturnValue(1_000);
        await withTempDirectory("minyami-http-pending-write-", async (directory) => {
            const destination = path.join(directory, "chunk.bin");
            const writeFile = fs.promises.writeFile;
            let notifyWriteStarted!: () => void;
            const writeStarted = new Promise<void>((resolve) => {
                notifyWriteStarted = resolve;
            });
            let releaseWrite!: () => void;
            const writeReleased = new Promise<void>((resolve) => {
                releaseWrite = resolve;
            });
            jest.spyOn(fs.promises, "writeFile").mockImplementationOnce(async (file, body, options) => {
                clock.mockReturnValue(30_000);
                await writeFile(file, "partial");
                notifyWriteStarted();
                await writeReleased;
                await writeFile(file, body, options);
            });
            const client = new DownloadHttpClient(normalizeDownloaderConfig());
            const adapter = respondWith(data);
            let settled = false;
            const transferPromise = client.download("https://example.com/chunk", destination, {
                adapter: (config) => {
                    clock.mockReturnValue(2_000);
                    return adapter(config);
                },
            });
            const download = transferPromise.then(() => {
                settled = true;
            });

            try {
                await writeStarted;
                expect(settled).toBe(false);
                expect(fs.existsSync(destination)).toBe(false);
                expect(fs.readFileSync(destination + ".t", "utf8")).toBe("partial");
            } finally {
                releaseWrite();
                await download;
            }

            expect(fs.readFileSync(destination, "utf8")).toBe("complete downloaded chunk");
            expect(fs.readdirSync(directory)).toEqual(["chunk.bin"]);
            expect(await transferPromise).toEqual({ bytes: data.byteLength, startedAt: 1_000, completedAt: 2_000 });
        });
    });

    test("preserves a published destination on disk failure and replaces staged data on retry", async () => {
        await withTempDirectory("minyami-http-write-failure-", async (directory) => {
            const destination = path.join(directory, "chunk.bin");
            fs.writeFileSync(destination, "previous complete chunk");
            const writeFile = fs.promises.writeFile;
            const failure = new Error("disk full");
            jest.spyOn(fs.promises, "writeFile").mockImplementationOnce(async (file) => {
                await writeFile(file, "partial");
                throw failure;
            });
            const client = new DownloadHttpClient(normalizeDownloaderConfig());
            const options = { adapter: respondWith(Buffer.from("retried complete chunk")) };

            await expect(client.download("https://example.com/chunk", destination, options)).rejects.toBe(failure);
            expect(fs.readFileSync(destination, "utf8")).toBe("previous complete chunk");

            await client.download("https://example.com/chunk", destination, options);
            expect(fs.readFileSync(destination, "utf8")).toBe("retried complete chunk");
            expect(fs.readdirSync(directory)).toEqual(["chunk.bin"]);
        });
    });

    test("does not publish a chunk cancelled while its disk write completes", async () => {
        await withTempDirectory("minyami-http-write-abort-", async (directory) => {
            const destination = path.join(directory, "chunk.bin");
            const abort = new AbortController();
            const writeFile = fs.promises.writeFile;
            jest.spyOn(fs.promises, "writeFile").mockImplementationOnce(async (file, body, options) => {
                await writeFile(file, body, options);
                abort.abort();
            });
            const client = new DownloadHttpClient(normalizeDownloaderConfig());

            await expect(
                client.download("https://example.com/chunk", destination, {
                    adapter: respondWith(Buffer.from("complete downloaded chunk")),
                    signal: abort.signal,
                }),
            ).rejects.toMatchObject({ name: "AbortError" });
            expect(fs.existsSync(destination)).toBe(false);
            expect(fs.readFileSync(destination + ".t", "utf8")).toBe("complete downloaded chunk");
        });
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

    test.each([true, false])("preserves gzip content and measures bytes with Content-Length=%s", async (hasLength) => {
        const resource = Buffer.from("media-chunk".repeat(100));
        const encoded = gzipSync(resource);
        const server = http.createServer((_request, response) => {
            response.setHeader("content-encoding", "gzip");
            if (hasLength) {
                response.setHeader("content-length", encoded.length);
            } else {
                response.setHeader("transfer-encoding", "chunked");
            }
            response.end(encoded);
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-http-gzip-", async (directory) => {
                const destination = path.join(directory, "chunk.bin");
                const client = new DownloadHttpClient(normalizeDownloaderConfig());

                const transfer = await client.download(`${baseUrl}/chunk`, destination);

                expect(fs.readFileSync(destination)).toEqual(resource);
                expect(transfer.bytes).toBe(hasLength ? encoded.length : resource.length);
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
