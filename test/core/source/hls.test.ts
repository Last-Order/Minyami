import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { AddressInfo } from "net";
import { describe, expect, test } from "@jest/globals";
import { createDownloader } from "../../../src/core/download/downloader";
import { createHLSSource } from "../../../src/core/source/hls";
import { withTempDirectory } from "../../helpers/filesystem";
import { close, listen } from "../../helpers/http";

describe("HLSSource", () => {
    test("resolves playlist encryption metadata and produces decryptable items", async () => {
        const key = Buffer.from("0123456789abcdef");
        const iv = Buffer.alloc(16);
        iv[15] = 1;
        const expected = Buffer.from("encrypted chunk payload");
        const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
        const encrypted = Buffer.concat([cipher.update(expected), cipher.final()]);
        const server = http.createServer((request, response) => {
            const address = server.address() as AddressInfo;
            if (request.url === "/key") {
                response.end(key);
                return;
            }
            if (request.url === "/0.ts") {
                response.end(encrypted);
                return;
            }
            response.end(
                [
                    "#EXTM3U",
                    `#EXT-X-KEY:METHOD=AES-128,URI="http://127.0.0.1:${address.port}/key",IV=0x00000000000000000000000000000001`,
                    "#EXTINF:1,",
                    `http://127.0.0.1:${address.port}/0.ts`,
                    "#EXT-X-ENDLIST",
                ].join("\n")
            );
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-encrypted-hls-", async (directory) => {
                const output = path.join(directory, "encrypted.ts");
                const source = createHLSSource(`${baseUrl}/playlist.m3u8`, { mode: "snapshot" });
                const downloader = createDownloader(source, { output, tempDir: directory });

                await downloader.download();

                expect(downloader.getSnapshot()).toMatchObject({
                    status: "finished",
                    completedChunkCount: 1,
                    successfulChunkCount: 1,
                    successfulDuration: 1,
                });
                expect(fs.readFileSync(output)).toEqual(expected);
            });
        } finally {
            await close(server);
        }
    });
});
