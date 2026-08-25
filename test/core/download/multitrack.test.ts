import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { createDownloader } from "@/core/download/downloader";
import { MPEG_TS_CONTAINER } from "@/core/media_container";
import { DownloadItemNamingContext, DownloadSource, SourceTrack } from "@/core/source/types";
import { close, listen } from "../../helpers/http";
import { withTempDirectory } from "../../helpers/filesystem";

describe("multi-track downloads", () => {
    test("shares scheduling while preserving independent track order and output", async () => {
        const payloads: Record<string, string> = {
            "/video-0": "video-zero",
            "/video-1": "video-one",
            "/audio-0": "audio-zero",
            "/audio-1": "audio-one",
        };
        const server = http.createServer((request, response) => {
            const send = () => response.end(payloads[request.url!]);
            request.url === "/video-0" ? setTimeout(send, 30) : send();
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-multitrack-", async (directory) => {
                const output = path.join(directory, "media.ts");
                const namingContexts: DownloadItemNamingContext[] = [];
                const tracks: readonly SourceTrack[] = (["video", "audio"] as const).map((id) => ({
                    id,
                    // Logical ids are intentionally unsafe as paths; only SourceTrack.id is an execution id.
                    mediaTrack: {
                        id: id === "video" ? "dash/video:1080p" : "dash/audio:en",
                        type: id,
                        ...(id === "video" ? { codecs: ["avc1.640028"] } : {}),
                        ...(id === "audio" ? { language: "en", name: "English" } : {}),
                    },
                    sourcePath: `${baseUrl}/${id}.m3u8`,
                    itemNamer: (_item, context) => {
                        namingContexts.push(context);
                        return `${context.trackIndex}.bin`;
                    },
                }));
                const source: DownloadSource = {
                    sourcePath: "custom://presentation",
                    continuous: false,
                    async prepare() {
                        return { container: MPEG_TS_CONTAINER, tracks };
                    },
                    async *discover() {
                        yield {
                            trackId: "video",
                            items: [{ url: `${baseUrl}/video-0`, kind: "media", duration: 1 }],
                            totalItemCount: 2,
                        };
                        yield {
                            trackId: "audio",
                            items: [
                                { url: `${baseUrl}/audio-0`, kind: "media", duration: 1 },
                                { url: `${baseUrl}/audio-1`, kind: "media", duration: 1 },
                            ],
                            totalItemCount: 2,
                        };
                        yield {
                            trackId: "video",
                            items: [{ url: `${baseUrl}/video-1`, kind: "media", duration: 1 }],
                        };
                    },
                };
                const downloader = createDownloader(source, {
                    output,
                    tempDir: directory,
                    threads: 4,
                    muxers: [],
                });
                const downloadedTrackIds: string[] = [];
                downloader.on("chunk-downloaded", (info) => downloadedTrackIds.push(info.trackId));

                await downloader.download();

                const videoOutput = path.join(directory, "media.video.ts");
                const audioOutput = path.join(directory, "media.audio.ts");
                expect(fs.readFileSync(videoOutput, "utf8")).toBe("video-zerovideo-one");
                expect(fs.readFileSync(audioOutput, "utf8")).toBe("audio-zeroaudio-one");
                expect(namingContexts).toEqual([
                    { taskId: 0, trackId: "video", trackIndex: 0 },
                    { taskId: 1, trackId: "audio", trackIndex: 0 },
                    { taskId: 2, trackId: "audio", trackIndex: 1 },
                    { taskId: 3, trackId: "video", trackIndex: 1 },
                ]);
                expect(downloadedTrackIds.sort()).toEqual(["audio", "audio", "video", "video"]);
                const snapshot = downloader.getSnapshot();
                expect(snapshot).toMatchObject({
                    sourcePath: "custom://presentation",
                    outputBasePath: path.join(directory, "media"),
                    outputPaths: [videoOutput, audioOutput],
                    artifacts: [
                        {
                            trackId: "video",
                            mediaTrack: { id: "dash/video:1080p", type: "video" },
                            outputPaths: [videoOutput],
                        },
                        {
                            trackId: "audio",
                            mediaTrack: { id: "dash/audio:en", type: "audio", language: "en" },
                            outputPaths: [audioOutput],
                        },
                    ],
                    totalChunkCount: 4,
                    completedChunkCount: 4,
                    successfulDuration: 4,
                    tracks: [
                        {
                            id: "video",
                            mediaTrack: { id: "dash/video:1080p", type: "video" },
                            sourcePath: `${baseUrl}/video.m3u8`,
                            plannedOutputPath: videoOutput,
                            outputPaths: [videoOutput],
                            totalChunkCount: 2,
                            successfulChunkCount: 2,
                            successfulDuration: 2,
                        },
                        {
                            id: "audio",
                            mediaTrack: { id: "dash/audio:en", type: "audio", language: "en" },
                            sourcePath: `${baseUrl}/audio.m3u8`,
                            plannedOutputPath: audioOutput,
                            outputPaths: [audioOutput],
                            totalChunkCount: 2,
                            successfulChunkCount: 2,
                            successfulDuration: 2,
                        },
                    ],
                });
                expect(snapshot.tracks[0].mediaTrack).toBe(tracks[0].mediaTrack);
                expect(snapshot.tracks[1].mediaTrack).toBe(tracks[1].mediaTrack);
                expect(snapshot.artifacts[0].mediaTrack).toBe(tracks[0].mediaTrack);
                expect(snapshot.artifacts[1].mediaTrack).toBe(tracks[1].mediaTrack);
                expect(fs.readdirSync(directory).sort()).toEqual(["media.audio.ts", "media.video.ts"]);
            });
        } finally {
            await close(server);
        }
    });

    test("a dropped item splits only its own track", async () => {
        const server = http.createServer((request, response) => {
            if (request.url === "/video-failed") {
                response.statusCode = 500;
                response.end("failed");
                return;
            }
            response.end(request.url!.slice(1));
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-multitrack-gap-", async (directory) => {
                const output = path.join(directory, "media.ts");
                const source = createTwoTrackSource(baseUrl, {
                    video: ["video-first", "video-failed", "video-second"],
                    audio: ["audio-first", "audio-second"],
                });
                const downloader = createDownloader(source, {
                    output,
                    tempDir: directory,
                    taskAttempts: 1,
                    threads: 5,
                    muxers: [],
                });
                const errorTrackIds: string[] = [];
                downloader.on("chunk-error", (_error, _taskName, trackId) => errorTrackIds.push(trackId));

                await downloader.download();

                const videoOutputs = [
                    path.join(directory, "media.video_0.ts"),
                    path.join(directory, "media.video_1.ts"),
                ];
                const audioOutput = path.join(directory, "media.audio.ts");
                expect(videoOutputs.map((file) => fs.readFileSync(file, "utf8"))).toEqual([
                    "video-first",
                    "video-second",
                ]);
                expect(fs.readFileSync(audioOutput, "utf8")).toBe("audio-firstaudio-second");
                expect(errorTrackIds).toEqual(["video"]);
                expect(downloader.getSnapshot()).toMatchObject({
                    outputPaths: [...videoOutputs, audioOutput],
                    completedChunkCount: 5,
                    successfulChunkCount: 4,
                    droppedChunkCount: 1,
                    tracks: [
                        { id: "video", completedChunkCount: 3, successfulChunkCount: 2, droppedChunkCount: 1 },
                        { id: "audio", completedChunkCount: 2, successfulChunkCount: 2, droppedChunkCount: 0 },
                    ],
                });
            });
        } finally {
            await close(server);
        }
    });

    test("keeps no-merge items isolated by track", async () => {
        const server = http.createServer((request, response) => response.end(request.url!.slice(1)));
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-multitrack-no-merge-", async (directory) => {
                const source = createTwoTrackSource(baseUrl, { video: ["same"], audio: ["same"] }, () => "same.bin");
                const downloader = createDownloader(source, { noMerge: true, tempDir: directory });

                await downloader.download();

                const snapshot = downloader.getSnapshot();
                expect(snapshot.outputPaths).toEqual([]);
                expect(snapshot.tracks.map((track) => track.outputPaths)).toEqual([[], []]);
                expect(fs.readFileSync(path.join(snapshot.tempPath, "video", "same.bin"), "utf8")).toBe("same");
                expect(fs.readFileSync(path.join(snapshot.tempPath, "audio", "same.bin"), "utf8")).toBe("same");
            });
        } finally {
            await close(server);
        }
    });

    test("an empty track finalizes without creating an output file", async () => {
        const server = http.createServer((_request, response) => response.end("video-only"));
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-multitrack-empty-", async (directory) => {
                const output = path.join(directory, "media.ts");
                const downloader = createDownloader(
                    createTwoTrackSource(baseUrl, { video: ["video-only"], audio: [] }),
                    { output, tempDir: directory }
                );

                await downloader.download();

                const videoOutput = path.join(directory, "media.video.ts");
                expect(fs.readFileSync(videoOutput, "utf8")).toBe("video-only");
                expect(downloader.getSnapshot()).toMatchObject({
                    outputPaths: [videoOutput],
                    tracks: [
                        { id: "video", totalChunkCount: 1, outputPaths: [videoOutput] },
                        { id: "audio", totalChunkCount: 0, outputPaths: [] },
                    ],
                });
                expect(fs.readdirSync(directory)).toEqual(["media.video.ts"]);
            });
        } finally {
            await close(server);
        }
    });

    test("rejects a source filename that escapes its track directory", async () => {
        await withTempDirectory("minyami-invalid-item-name-", async (directory) => {
            const source: DownloadSource = {
                sourcePath: "custom://unsafe-name",
                continuous: false,
                async prepare() {
                    return {
                        container: MPEG_TS_CONTAINER,
                        tracks: [
                            {
                                ...createTrack("main"),
                                itemNamer: () => "../escape.ts",
                            },
                        ],
                    };
                },
                async *discover() {
                    yield {
                        trackId: "main",
                        items: [{ url: "https://example.com/unused.ts", kind: "media", duration: 1 }],
                        totalItemCount: 1,
                    };
                },
            };

            await expect(createDownloader(source, { noMerge: true, tempDir: directory }).download()).rejects.toThrow(
                "Invalid output filename"
            );
            expect(fs.existsSync(path.join(directory, "escape.ts"))).toBe(false);
        });
    });

    test.each([
        { offset: -1, length: 1 },
        { offset: 0, length: 0 },
        { offset: Number.MAX_SAFE_INTEGER, length: 2 },
    ])("rejects an invalid download byte range $offset+$length before execution", async (byteRange) => {
        await withTempDirectory("minyami-invalid-byte-range-", async (directory) => {
            const source: DownloadSource = {
                sourcePath: "custom://invalid-byte-range",
                continuous: false,
                async prepare() {
                    return { container: MPEG_TS_CONTAINER, tracks: [createTrack("main")] };
                },
                async *discover() {
                    yield {
                        trackId: "main",
                        items: [
                            {
                                url: "https://example.com/unused.ts",
                                kind: "media",
                                duration: 1,
                                byteRange,
                            },
                        ],
                        totalItemCount: 1,
                    };
                },
            };

            await expect(createDownloader(source, { noMerge: true, tempDir: directory }).download()).rejects.toThrow(
                "Download byte range"
            );
        });
    });

    test.each([
        {
            name: "empty track list",
            tracks: [],
            message: "at least one track",
        },
        {
            name: "duplicate track ids",
            tracks: [createTrack("Main"), createTrack("main")],
            message: "Duplicate download track id",
        },
        {
            name: "unsafe track id",
            tracks: [createTrack("../video")],
            message: "Invalid download track id",
        },
    ])("rejects $name during preparation", async ({ tracks, message }) => {
        await withTempDirectory("minyami-invalid-tracks-", async (directory) => {
            const source: DownloadSource = {
                sourcePath: "custom://invalid-tracks",
                continuous: false,
                async prepare() {
                    return { container: MPEG_TS_CONTAINER, tracks };
                },
                async *discover() {
                    throw new Error("Invalid tracks must fail before discovery.");
                },
            };

            await expect(createDownloader(source, { tempDir: directory }).download()).rejects.toThrow(message);
        });
    });

    test.each([
        {
            name: "an unknown track batch",
            batches: [{ trackId: "audio", items: [] }],
            message: "unknown track",
        },
    ])("rejects $name", async ({ batches, message }) => {
        await withTempDirectory("minyami-invalid-batch-", async (directory) => {
            const source: DownloadSource = {
                sourcePath: "custom://invalid-batch",
                continuous: false,
                async prepare() {
                    return { container: MPEG_TS_CONTAINER, tracks: [createTrack("main")] };
                },
                async *discover() {
                    for (const batch of batches) {
                        yield batch;
                    }
                },
            };

            await expect(createDownloader(source, { noMerge: true, tempDir: directory }).download()).rejects.toThrow(
                message
            );
        });
    });
});

function createTrack(id: string, type: SourceTrack["mediaTrack"]["type"] = "video"): SourceTrack {
    return {
        id,
        mediaTrack: { id: `logical-${id}`, type },
        sourcePath: `custom://${id}`,
    };
}

function createTwoTrackSource(
    baseUrl: string,
    items: { readonly video: readonly string[]; readonly audio: readonly string[] },
    itemNamer?: SourceTrack["itemNamer"]
): DownloadSource {
    return {
        sourcePath: "custom://two-tracks",
        continuous: false,
        async prepare() {
            return {
                container: MPEG_TS_CONTAINER,
                tracks: [
                    { ...createTrack("video"), itemNamer },
                    { ...createTrack("audio", "audio"), itemNamer },
                ],
            };
        },
        async *discover() {
            for (const trackId of ["video", "audio"] as const) {
                yield {
                    trackId,
                    items: items[trackId].map((name) => ({
                        url: `${baseUrl}/${name}`,
                        kind: "media" as const,
                        duration: 1,
                    })),
                    totalItemCount: items[trackId].length,
                };
            }
        },
    };
}
