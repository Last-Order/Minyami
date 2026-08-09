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
import { StreamSelector, TrackSelection } from "../../../../src/core/source/stream_selection";
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
                { tempDir: directory }
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
                ].join("\n")
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

    test("rejects copied and cross-option selector tracks", async () => {
        const variants = [
            { ...createVariant("https://media.example/low.m3u8", 800000), audioGroupId: "audio" },
            createVariant("https://media.example/high.m3u8", 2400000),
        ];
        const master = {
            kind: HLSPlaylistKind.Master,
            variants,
            audioRenditions: [createAudioRendition("English", "en", "https://media.example/en.m3u8")],
        } as const;
        const loader = jest.spyOn(PlaylistLoader.prototype, "load");
        loader.mockResolvedValueOnce(master);

        await withTempDirectory("minyami-copied-track-", async (directory) => {
            const downloader = createDownloader(
                createHLSSource("https://media.example/master.m3u8", {
                    mode: "snapshot",
                    streamSelector: (catalog) => [{ ...catalog.tracks[0] }],
                }),
                { tempDir: directory }
            );
            await expect(downloader.download()).rejects.toThrow("track that was not offered");
        });

        loader.mockResolvedValueOnce(master);
        await withTempDirectory("minyami-incompatible-tracks-", async (directory) => {
            const downloader = createDownloader(
                createHLSSource("https://media.example/master.m3u8", {
                    mode: "snapshot",
                    streamSelector: (catalog) => [catalog.options[1].tracks[0], catalog.options[0].tracks[1]],
                }),
                { tempDir: directory }
            );
            await expect(downloader.download()).rejects.toThrow("one compatible stream option");
        });
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
        loader.mockResolvedValueOnce({ kind: HLSPlaylistKind.Master, variants: [], audioRenditions: [] });

        await withTempDirectory("minyami-empty-master-", async (directory) => {
            const downloader = createDownloader(
                createHLSSource("https://media.example/empty.m3u8", { mode: "snapshot" }),
                { tempDir: directory }
            );
            await expect(downloader.download()).rejects.toThrow("Master playlist does not contain any stream options.");
        });

        const variant = createVariant("https://media.example/nested.m3u8", 1000000);
        const master = { kind: HLSPlaylistKind.Master, variants: [variant], audioRenditions: [] } as const;
        loader.mockResolvedValueOnce(master).mockResolvedValueOnce(master);

        await withTempDirectory("minyami-nested-master-", async (directory) => {
            const downloader = createDownloader(
                createHLSSource("https://media.example/master.m3u8", { mode: "snapshot" }),
                { tempDir: directory }
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
        encryptionKeyUrls: [],
        hasEndList: true,
        totalDuration: 0,
        averageSegmentDuration: 0,
    };
}
