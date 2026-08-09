import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { AddressInfo } from "net";
import { describe, expect, jest, test } from "@jest/globals";
import { createDownloader } from "../../../../src/core/download/downloader";
import { createHLSSource } from "../../../../src/core/source/hls";
import { HLSMediaPlaylist, HLSPlaylistKind, HLSVariant } from "../../../../src/core/source/hls/parser";
import { PlaylistLoader } from "../../../../src/core/source/hls/playlist_loader";
import { withTempDirectory } from "../../../helpers/filesystem";
import { close, listen } from "../../../helpers/http";

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

    test("derives an omitted media IV from the media sequence", async () => {
        const key = Buffer.from("0123456789abcdef");
        const iv = Buffer.alloc(16);
        iv[15] = 7;
        const expected = Buffer.from("implicit HLS IV payload");
        const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
        const encrypted = Buffer.concat([cipher.update(expected), cipher.final()]);
        const server = http.createServer((request, response) => {
            if (request.url === "/key") {
                response.end(key);
                return;
            }
            if (request.url === "/7.ts") {
                response.end(encrypted);
                return;
            }
            const address = server.address() as AddressInfo;
            response.end(
                [
                    "#EXTM3U",
                    "#EXT-X-MEDIA-SEQUENCE:7",
                    `#EXT-X-KEY:METHOD=AES-128,URI="http://127.0.0.1:${address.port}/key"`,
                    "#EXTINF:1,",
                    `http://127.0.0.1:${address.port}/7.ts`,
                    "#EXT-X-ENDLIST",
                ].join("\n")
            );
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-implicit-hls-iv-", async (directory) => {
                const output = path.join(directory, "encrypted.ts");
                const source = createHLSSource(`${baseUrl}/playlist.m3u8`, { mode: "snapshot" });
                const downloader = createDownloader(source, { output, tempDir: directory });

                await downloader.download();

                expect(fs.readFileSync(output)).toEqual(expected);
            });
        } finally {
            await close(server);
        }
    });

    test("selects a single master variant without invoking the selector", async () => {
        const variant = createVariant("https://media.example/only.m3u8", 1000000);
        jest.spyOn(PlaylistLoader.prototype, "load")
            .mockResolvedValueOnce({ kind: HLSPlaylistKind.Master, variants: [variant] })
            .mockResolvedValueOnce(emptyMediaPlaylist());
        const variantSelector = jest.fn(() => variant);

        await withTempDirectory("minyami-single-variant-", async (directory) => {
            const downloader = createDownloader(
                createHLSSource("https://media.example/master.m3u8", { mode: "snapshot", variantSelector }),
                { tempDir: directory }
            );

            await downloader.download();

            expect(variantSelector).not.toHaveBeenCalled();
            expect(downloader.getSnapshot().sourcePath).toBe(variant.url);
        });
    });

    test("rejects a variant selector result outside the offered candidates", async () => {
        const variants = [
            createVariant("https://media.example/low.m3u8", 800000),
            createVariant("https://media.example/high.m3u8", 2400000),
        ];
        jest.spyOn(PlaylistLoader.prototype, "load").mockResolvedValueOnce({
            kind: HLSPlaylistKind.Master,
            variants,
        });

        await withTempDirectory("minyami-invalid-variant-", async (directory) => {
            const downloader = createDownloader(
                createHLSSource("https://media.example/master.m3u8", {
                    mode: "snapshot",
                    variantSelector: () => ({ ...variants[0] }),
                }),
                { tempDir: directory }
            );

            await expect(downloader.download()).rejects.toThrow(
                "HLS variant selector returned a stream that was not offered by the master playlist."
            );
            expect(downloader.getSnapshot().status).toBe("failed");
        });
    });

    test("treats an undefined variant selection as normal cancellation", async () => {
        const variants = [
            createVariant("https://media.example/low.m3u8", 800000),
            createVariant("https://media.example/high.m3u8", 2400000),
        ];
        jest.spyOn(PlaylistLoader.prototype, "load").mockResolvedValueOnce({
            kind: HLSPlaylistKind.Master,
            variants,
        });

        await withTempDirectory("minyami-cancelled-variant-", async (directory) => {
            const output = path.join(directory, "cancelled.ts");
            const downloader = createDownloader(
                createHLSSource("https://media.example/master.m3u8", {
                    mode: "snapshot",
                    variantSelector: () => undefined,
                }),
                { output, tempDir: directory }
            );

            await expect(downloader.download()).resolves.toBeUndefined();

            expect(downloader.getSnapshot()).toMatchObject({ status: "finished", isEnd: true, totalChunkCount: 0 });
            expect(fs.existsSync(output)).toBe(false);
            expect(fs.readdirSync(directory)).toEqual([]);
        });
    });

    test("rejects an empty master playlist and a selected nested master playlist", async () => {
        const loader = jest.spyOn(PlaylistLoader.prototype, "load");
        loader.mockResolvedValueOnce({ kind: HLSPlaylistKind.Master, variants: [] });

        await withTempDirectory("minyami-empty-master-", async (directory) => {
            const downloader = createDownloader(
                createHLSSource("https://media.example/empty.m3u8", { mode: "snapshot" }),
                { tempDir: directory }
            );
            await expect(downloader.download()).rejects.toThrow("Master playlist does not contain any streams.");
        });

        const variant = createVariant("https://media.example/nested.m3u8", 1000000);
        loader
            .mockResolvedValueOnce({ kind: HLSPlaylistKind.Master, variants: [variant] })
            .mockResolvedValueOnce({ kind: HLSPlaylistKind.Master, variants: [variant] });

        await withTempDirectory("minyami-nested-master-", async (directory) => {
            const downloader = createDownloader(
                createHLSSource("https://media.example/master.m3u8", { mode: "snapshot" }),
                { tempDir: directory }
            );
            await expect(downloader.download()).rejects.toThrow(
                "Selected HLS stream points to another master playlist."
            );
        });
    });
});

function createVariant(url: string, bandwidth: number): HLSVariant {
    return { url, bandwidth };
}

function emptyMediaPlaylist(): HLSMediaPlaylist {
    return {
        kind: HLSPlaylistKind.Media,
        segments: [],
        encryptionKeyUrls: [],
        hasEndList: true,
        totalDuration: 0,
        averageSegmentDuration: 0,
    };
}
