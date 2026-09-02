import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import { AddressInfo } from "net";
import * as path from "path";
import { describe, expect, jest, test } from "@jest/globals";
import { createDownloader } from "@/core/download/downloader";
import { createHLSSource } from "@/core/source/hls";
import { PlaylistLoader } from "@/core/source/hls/playlist/loader";
import { HLSMediaPlaylist, HLSPlaylistKind, HLSVariant } from "@/core/source/hls/playlist/parser";
import { StreamSelector, TrackSelection } from "@/core/source/stream_selection";
import { withTempDirectory } from "../../../helpers/filesystem";
import { close, listen } from "../../../helpers/http";

describe("HLSSource", () => {
    test("downloads initialization and media byte ranges from one resource in playlist order", async () => {
        const resource = Buffer.from("INITfirstsecond");
        const requestedRanges: string[] = [];
        const server = http.createServer((request, response) => {
            if (request.url === "/media.mp4") {
                requestedRanges.push(String(request.headers.range));
                respondWithByteRange(request, response, resource);
                return;
            }
            response.end(
                [
                    "#EXTM3U",
                    '#EXT-X-MAP:URI="/media.mp4",BYTERANGE="4@0"',
                    "#EXTINF:1,",
                    "#EXT-X-BYTERANGE:5@4",
                    "/media.mp4",
                    "#EXTINF:1,",
                    "#EXT-X-BYTERANGE:6",
                    "/media.mp4",
                    "#EXT-X-ENDLIST",
                ].join("\n"),
            );
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-ranged-hls-", async (directory) => {
                const output = path.join(directory, "ranged.mp4");
                const downloader = createDownloader(createHLSSource(`${baseUrl}/playlist.m3u8`, { mode: "snapshot" }), {
                    output,
                    tempDir: directory,
                    threads: 3,
                });

                await downloader.download();

                expect(fs.readFileSync(output)).toEqual(resource);
                expect(requestedRanges.sort()).toEqual(["bytes=0-3", "bytes=4-8", "bytes=9-14"]);
            });
        } finally {
            await close(server);
        }
    });

    test("decrypts an AES-128 media segment after selecting its byte range", async () => {
        const key = Buffer.from("0123456789abcdef");
        const iv = Buffer.alloc(16);
        iv[15] = 1;
        const expected = Buffer.from("encrypted ranged chunk payload");
        const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
        const encrypted = Buffer.concat([cipher.update(expected), cipher.final()]);
        const prefix = Buffer.from("skip-");
        const resource = Buffer.concat([prefix, encrypted, Buffer.from("-tail")]);
        const server = http.createServer((request, response) => {
            if (request.url === "/key") {
                response.end(key);
                return;
            }
            if (request.url === "/media.bin") {
                respondWithByteRange(request, response, resource);
                return;
            }
            response.end(
                [
                    "#EXTM3U",
                    '#EXT-X-KEY:METHOD=AES-128,URI="/key",IV=0x00000000000000000000000000000001',
                    "#EXTINF:1,",
                    `#EXT-X-BYTERANGE:${encrypted.length}@${prefix.length}`,
                    "/media.bin",
                    "#EXT-X-ENDLIST",
                ].join("\n"),
            );
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-encrypted-ranged-hls-", async (directory) => {
                const output = path.join(directory, "encrypted-range.ts");
                const downloader = createDownloader(createHLSSource(`${baseUrl}/playlist.m3u8`, { mode: "snapshot" }), {
                    output,
                    tempDir: directory,
                });

                await downloader.download();

                expect(fs.readFileSync(output)).toEqual(expected);
            });
        } finally {
            await close(server);
        }
    });

    test("decrypts AES-128 media with an inline data key without a key request", async () => {
        const key = Buffer.from("0123456789abcdef");
        const iv = Buffer.alloc(16);
        iv[15] = 1;
        const expected = Buffer.from("inline HLS key payload");
        const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
        const encrypted = Buffer.concat([cipher.update(expected), cipher.final()]);
        const keyUri = `data:application/octet-stream;base64,${key.toString("base64")}`;
        const requestedPaths: string[] = [];
        const server = http.createServer((request, response) => {
            requestedPaths.push(request.url!);
            if (request.url === "/0.ts") {
                response.end(encrypted);
                return;
            }
            response.end(
                [
                    "#EXTM3U",
                    `#EXT-X-KEY:METHOD=AES-128,URI="${keyUri}",IV=0x00000000000000000000000000000001`,
                    "#EXTINF:1,",
                    "/0.ts",
                    "#EXT-X-ENDLIST",
                ].join("\n"),
            );
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-inline-hls-key-", async (directory) => {
                const output = path.join(directory, "inline-key.ts");
                const source = createHLSSource(`${baseUrl}/playlist.m3u8`, { mode: "snapshot" });
                const downloader = createDownloader(source, { output, tempDir: directory });

                await downloader.download();

                expect(requestedPaths).toEqual(["/playlist.m3u8", "/0.ts"]);
                expect(fs.readFileSync(output)).toEqual(expected);
            });
        } finally {
            await close(server);
        }
    });

    test("maps multiple explicit keys to distinct key URIs without requesting remote keys", async () => {
        const firstKey = Buffer.from("0123456789abcdef");
        const secondKey = Buffer.from("fedcba9876543210");
        const firstIv = Buffer.alloc(16, 1);
        const secondIv = Buffer.alloc(16, 2);
        const firstPayload = Buffer.from("first ordered-key payload");
        const secondPayload = Buffer.from("second ordered-key payload");
        const encrypt = (payload: Buffer, key: Buffer, iv: Buffer): Buffer => {
            const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
            return Buffer.concat([cipher.update(payload), cipher.final()]);
        };
        const encryptedPayloads: Record<string, Buffer> = {
            "/0.ts": encrypt(firstPayload, firstKey, firstIv),
            "/1.ts": encrypt(secondPayload, secondKey, secondIv),
        };
        let keyRequestCount = 0;
        const server = http.createServer((request, response) => {
            if (request.url === "/key-a" || request.url === "/key-b") {
                keyRequestCount++;
                response.end("remote key must not be requested");
                return;
            }
            if (encryptedPayloads[request.url!]) {
                response.end(encryptedPayloads[request.url!]);
                return;
            }
            const address = server.address() as AddressInfo;
            response.end(
                [
                    "#EXTM3U",
                    `#EXT-X-KEY:METHOD=AES-128,URI="http://127.0.0.1:${address.port}/key-a",IV=0x${firstIv.toString(
                        "hex",
                    )}`,
                    "#EXTINF:1,",
                    `http://127.0.0.1:${address.port}/0.ts`,
                    `#EXT-X-KEY:METHOD=AES-128,URI="http://127.0.0.1:${address.port}/key-b",IV=0x${secondIv.toString(
                        "hex",
                    )}`,
                    "#EXTINF:1,",
                    `http://127.0.0.1:${address.port}/1.ts`,
                    "#EXT-X-ENDLIST",
                ].join("\n"),
            );
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-explicit-hls-keys-", async (directory) => {
                const output = path.join(directory, "ordered-keys.ts");
                const source = createHLSSource(`${baseUrl}/playlist.m3u8`, {
                    mode: "snapshot",
                    explicitKeys: [{ key: firstKey.toString("hex") }, { key: secondKey.toString("hex") }],
                });
                const downloader = createDownloader(source, { output, tempDir: directory });

                await downloader.download();

                expect(keyRequestCount).toBe(0);
                expect(fs.readFileSync(output)).toEqual(Buffer.concat([firstPayload, secondPayload]));
            });
        } finally {
            await close(server);
        }
    });

    test("passes a protocol-neutral catalog to a selector and preserves its selected track order", async () => {
        const variant = { ...createVariant("https://media.example/video.m3u8", 1000000), audioGroupId: "audio" };
        const master = {
            kind: HLSPlaylistKind.Master,
            variants: [variant],
            audioRenditions: [
                createAudioRendition("English", "en", "https://media.example/en.m3u8"),
                createAudioRendition("Japanese", "ja", "https://media.example/ja.m3u8"),
            ],
        } as const;
        jest.spyOn(PlaylistLoader.prototype, "load")
            .mockResolvedValueOnce(master)
            .mockResolvedValueOnce(emptyMediaPlaylist())
            .mockResolvedValueOnce(emptyMediaPlaylist());
        let selectedTracks: TrackSelection | undefined;
        const streamSelector = jest.fn<StreamSelector>(async (catalog) => {
            expect(catalog.options).toHaveLength(1);
            expect(catalog.options[0].tracks.map((track) => track.type)).toEqual(["video", "audio", "audio"]);
            expect(catalog.options[0].tracks[2]).toMatchObject({ name: "Japanese", language: "ja" });
            expect(catalog.tracks.every((track) => !("url" in track))).toBe(true);
            selectedTracks = [catalog.options[0].tracks[2], catalog.options[0].tracks[0]];
            return selectedTracks;
        });

        await withTempDirectory("minyami-selected-tracks-", async (directory) => {
            const downloader = createDownloader(
                createHLSSource("https://media.example/master.m3u8", { mode: "snapshot", streamSelector }),
                { tempDir: directory },
            );

            await downloader.download();

            expect(streamSelector).toHaveBeenCalledTimes(1);
            const snapshot = downloader.getSnapshot();
            expect(snapshot).toMatchObject({
                sourcePath: "https://media.example/master.m3u8",
                tracks: [
                    {
                        id: "audio-2",
                        mediaTrack: { id: "audio-2", type: "audio", language: "ja" },
                        sourcePath: "https://media.example/ja.m3u8",
                    },
                    {
                        id: "video-1",
                        mediaTrack: { id: "video-1", type: "video" },
                        sourcePath: variant.url,
                    },
                ],
            });
            expect(snapshot.tracks[0].mediaTrack).toBe(selectedTracks![0]);
            expect(snapshot.tracks[1].mediaTrack).toBe(selectedTracks![1]);
        });
    });

    test("downloads every track in the default HLS stream option to an independent output", async () => {
        const payloads: Record<string, string> = {
            "/video.ts": "video",
            "/en.ts": "english",
            "/ja.ts": "japanese",
        };
        const server = http.createServer((request, response) => {
            if (payloads[request.url!]) {
                response.end(payloads[request.url!]);
                return;
            }
            if (request.url === "/video.m3u8" || request.url === "/en.m3u8" || request.url === "/ja.m3u8") {
                const segment = request.url.replace(".m3u8", ".ts");
                response.end(["#EXTM3U", "#EXTINF:1,", segment, "#EXT-X-ENDLIST"].join("\n"));
                return;
            }
            response.end(
                [
                    "#EXTM3U",
                    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="/en.m3u8"',
                    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Japanese",LANGUAGE="ja",DEFAULT=NO,AUTOSELECT=YES,URI="/ja.m3u8"',
                    '#EXT-X-STREAM-INF:BANDWIDTH=2000000,AUDIO="audio",RESOLUTION=1280x720',
                    "/video.m3u8",
                ].join("\n"),
            );
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-hls-renditions-", async (directory) => {
                const output = path.join(directory, "media.ts");
                const downloader = createDownloader(createHLSSource(`${baseUrl}/master.m3u8`, { mode: "snapshot" }), {
                    output,
                    tempDir: directory,
                    threads: 3,
                    muxers: [],
                });

                await downloader.download();

                const expectedPaths = [
                    path.join(directory, "media.video-1.ts"),
                    path.join(directory, "media.audio-1.ts"),
                    path.join(directory, "media.audio-2.ts"),
                ];
                expect(downloader.getSnapshot()).toMatchObject({
                    outputPaths: expectedPaths,
                    tracks: [
                        { id: "video-1", sourcePath: `${baseUrl}/video.m3u8` },
                        { id: "audio-1", sourcePath: `${baseUrl}/en.m3u8` },
                        { id: "audio-2", sourcePath: `${baseUrl}/ja.m3u8` },
                    ],
                });
                expect(expectedPaths.map((file) => fs.readFileSync(file, "utf8"))).toEqual([
                    "video",
                    "english",
                    "japanese",
                ]);
            });
        } finally {
            await close(server);
        }
    });

    test("treats an undefined track selection as normal cancellation", async () => {
        jest.spyOn(PlaylistLoader.prototype, "load").mockResolvedValueOnce({
            kind: HLSPlaylistKind.Master,
            variants: [createVariant("https://media.example/low.m3u8", 800000)],
            audioRenditions: [],
        });

        await withTempDirectory("minyami-cancelled-selection-", async (directory) => {
            const output = path.join(directory, "cancelled.ts");
            const downloader = createDownloader(
                createHLSSource("https://media.example/master.m3u8", {
                    mode: "snapshot",
                    streamSelector: () => undefined,
                }),
                { output, tempDir: directory },
            );

            await expect(downloader.download()).resolves.toBeUndefined();

            expect(downloader.getSnapshot()).toMatchObject({ status: "finished", isEnd: true, totalChunkCount: 0 });
            expect(fs.existsSync(output)).toBe(false);
            expect(fs.readdirSync(directory)).toEqual([]);
        });
    });

    test("rejects a selected nested master playlist", async () => {
        const loader = jest.spyOn(PlaylistLoader.prototype, "load");
        const variant = createVariant("https://media.example/nested.m3u8", 1000000);
        const master = { kind: HLSPlaylistKind.Master, variants: [variant], audioRenditions: [] } as const;
        loader.mockResolvedValueOnce(master).mockResolvedValueOnce(master);

        await withTempDirectory("minyami-nested-master-", async (directory) => {
            const downloader = createDownloader(
                createHLSSource("https://media.example/master.m3u8", { mode: "snapshot" }),
                { tempDir: directory },
            );
            await expect(downloader.download()).rejects.toThrow("points to another master playlist");
        });
    });
});

function createVariant(url: string, bandwidth: number): HLSVariant {
    return { url, bandwidth };
}

function createAudioRendition(name: string, language: string, url: string) {
    return {
        groupId: "audio",
        name,
        language,
        url,
        isDefault: language === "en",
        autoSelect: true,
    };
}

function emptyMediaPlaylist(): HLSMediaPlaylist {
    return {
        kind: HLSPlaylistKind.Media,
        segments: [],
        keys: [],
        hasEndList: true,
        totalDuration: 0,
        averageSegmentDuration: 0,
    };
}

function respondWithByteRange(request: http.IncomingMessage, response: http.ServerResponse, resource: Buffer): void {
    const match = String(request.headers.range).match(/^bytes=([0-9]+)-([0-9]+)$/);
    if (!match) {
        response.statusCode = 400;
        response.end("missing range");
        return;
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start < 0 || end < start || end >= resource.length) {
        response.statusCode = 416;
        response.end();
        return;
    }
    const body = resource.subarray(start, end + 1);
    response.statusCode = 206;
    response.setHeader("content-range", `bytes ${start}-${end}/${resource.length}`);
    response.setHeader("content-length", body.length);
    response.end(body);
}
