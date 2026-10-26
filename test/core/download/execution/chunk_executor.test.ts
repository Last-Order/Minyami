import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { describe, expect, jest, test } from "@jest/globals";
import { normalizeDownloaderConfig } from "@/core/download/config";
import { Aes128CbcHandler } from "@/core/download/encryption/aes_128_cbc/handler";
import { EncryptionHandlerRegistry } from "@/core/download/encryption/registry";
import { ChunkExecutor } from "@/core/download/execution/chunk_executor";
import { DownloadTask } from "@/core/download/execution/task";
import { DownloadHttpClient } from "@/core/download/infrastructure/http_client";
import { KeyStore } from "@/core/download/infrastructure/key_store";
import { runWithAbortSignal } from "@/utils/abort";
import { withTempDirectory } from "../../../helpers/filesystem";
import { close, listen } from "../../../helpers/http";

describe("ChunkExecutor encryption lifecycle", () => {
    test.each([false, true])("retains the encrypted input when keepEncryptedChunks is %s", async (keep) => {
        const clock = jest.spyOn(performance, "now").mockReturnValue(0);
        const key = Buffer.from("0123456789abcdef");
        const iv = Buffer.alloc(16);
        iv[15] = 1;
        const plaintext = Buffer.from("executor encrypted payload");
        const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const server = http.createServer((_request, response) => {
            clock.mockReturnValue(1_000);
            response.end(encrypted);
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-chunk-executor-", async (directory) => {
                const keys = new KeyStore();
                keys.set("test:key", key.toString("hex"));
                const config = normalizeDownloaderConfig({ tempDir: directory });
                const handler = new Aes128CbcHandler();
                const decrypt = handler.decrypt.bind(handler);
                jest.spyOn(handler, "decrypt").mockImplementation(async (request) => {
                    clock.mockReturnValue(10_000);
                    await decrypt(request);
                });
                const executor = new ChunkExecutor(
                    new DownloadHttpClient(config),
                    keys,
                    new EncryptionHandlerRegistry([handler]),
                );
                const task: DownloadTask = {
                    id: 0,
                    trackId: "main",
                    trackIndex: 0,
                    filename: "000000_chunk.ts",
                    item: {
                        url: `${baseUrl}/chunk.ts`,
                        kind: "media",
                        duration: 1,
                        encryption: { scheme: "aes-128-cbc", keyId: "test:key", iv: "1" },
                    },
                };

                const result = await runWithAbortSignal(new AbortController().signal, () =>
                    executor.execute(task, {
                        tempPath: directory,
                        itemTimeout: 1000,
                        keepEncryptedChunks: keep,
                        attempt: 1,
                    }),
                );

                expect(fs.readFileSync(result.outputPath)).toEqual(plaintext);
                expect(result.transfer).toEqual({ bytes: encrypted.length, startedAt: 0, completedAt: 1_000 });
                expect(fs.existsSync(path.join(directory, task.filename))).toBe(keep);
            });
        } finally {
            await close(server);
        }
    });
});
