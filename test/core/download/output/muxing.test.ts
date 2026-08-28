import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { createDownloader } from "@/core/download/downloader";
import { AAC_CONTAINER, MATROSKA_CONTAINER, MediaContainer, MPEG_TS_CONTAINER } from "@/core/media_container";
import { Muxer, MuxRequest } from "@/core/muxer";
import { DownloadSource } from "@/core/source/types";
import { withTempDirectory } from "../../../helpers/filesystem";
import { close, listen } from "../../../helpers/http";

class TestMuxer implements Muxer {
    availabilityChecks = 0;
    readonly requests: MuxRequest[] = [];

    constructor(
        readonly name: string,
        private readonly available: boolean,
        readonly outputContainer: MediaContainer = MATROSKA_CONTAINER
    ) {}

    async isAvailable(): Promise<boolean> {
        this.availabilityChecks++;
        return this.available;
    }

    async mux(request: MuxRequest): Promise<void> {
        this.requests.push(request);
        // Reading here proves both track concentrators completed before muxing starts.
        const content = request.inputs.map((input) => fs.readFileSync(input.inputPath, "utf8")).join("+");
        fs.writeFileSync(request.outputPath, content);
    }
}

describe("download output muxing", () => {
    test("muxes completed audio and video tracks with the first available muxer", async () => {
        const server = http.createServer((request, response) => response.end(request.url!.slice(1)));
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-muxing-", async (directory) => {
                const requestedOutput = path.join(directory, "media.webm");
                const output = path.join(directory, "media.mkv");
                const preferred = new TestMuxer("preferred", true);
                const fallback = new TestMuxer("fallback", true);
                const downloader = createDownloader(createTwoTrackSource(baseUrl), {
                    output: requestedOutput,
                    tempDir: directory,
                    muxers: [preferred, fallback],
                });

                await downloader.download();

                const videoOutput = path.join(directory, "media.video.ts");
                const audioOutput = path.join(directory, "media.audio.ts");
                expect(fs.readFileSync(output, "utf8")).toBe("video+audio");
                expect(preferred.requests).toHaveLength(1);
                expect(preferred.requests[0]).toMatchObject({
                    outputPath: output,
                    inputs: [
                        { trackId: "video", mediaTrack: { type: "video" }, inputPath: videoOutput },
                        { trackId: "audio", mediaTrack: { type: "audio" }, inputPath: audioOutput },
                    ],
                });
                expect(fallback.availabilityChecks).toBe(0);
                expect(downloader.getSnapshot()).toMatchObject({
                    outputPaths: [output],
                    artifacts: [],
                    tracks: [{ outputPaths: [] }, { outputPaths: [] }],
                });
                expect(fs.existsSync(videoOutput)).toBe(false);
                expect(fs.existsSync(audioOutput)).toBe(false);
                expect(fs.readdirSync(directory)).toEqual(["media.mkv"]);
            });
        } finally {
            await close(server);
        }
    });

    test("falls back in order and keeps track outputs when no muxer is available", async () => {
        const server = http.createServer((request, response) => response.end(request.url!.slice(1)));
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-no-muxer-", async (directory) => {
                const output = path.join(directory, "media.ts");
                const mkvmerge = new TestMuxer("mkvmerge", false);
                const ffmpeg = new TestMuxer("ffmpeg", false);
                const downloader = createDownloader(createTwoTrackSource(baseUrl), {
                    output,
                    tempDir: directory,
                    muxers: [mkvmerge, ffmpeg],
                });

                await downloader.download();

                const expectedOutputs = [
                    path.join(directory, "media.video.ts"),
                    path.join(directory, "media.audio.ts"),
                ];
                expect(mkvmerge.availabilityChecks).toBe(1);
                expect(ffmpeg.availabilityChecks).toBe(1);
                expect(downloader.getSnapshot().outputPaths).toEqual(expectedOutputs);
                expect(expectedOutputs.every((file) => fs.existsSync(file))).toBe(true);
                expect(fs.existsSync(output)).toBe(false);
            });
        } finally {
            await close(server);
        }
    });

    test("uses per-track container overrides for retained mixed-container artifacts", async () => {
        const server = http.createServer((request, response) => response.end(request.url!.slice(1)));
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-mixed-track-containers-", async (directory) => {
                const downloader = createDownloader(createTwoTrackSource(baseUrl, ["video"], AAC_CONTAINER), {
                    output: path.join(directory, "media.ts"),
                    tempDir: directory,
                    muxers: [],
                });

                await downloader.download();

                const videoOutput = path.join(directory, "media.video.ts");
                const audioOutput = path.join(directory, "media.audio.aac");
                expect(fs.readFileSync(videoOutput, "utf8")).toBe("video");
                expect(fs.readFileSync(audioOutput, "utf8")).toBe("audio");
                expect(downloader.getSnapshot().outputPaths).toEqual([videoOutput, audioOutput]);
            });
        } finally {
            await close(server);
        }
    });

    test("passes correctly typed mixed-container paths to the muxer", async () => {
        const server = http.createServer((request, response) => response.end(request.url!.slice(1)));
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-mixed-container-muxing-", async (directory) => {
                const muxer = new TestMuxer("mixed", true);
                const downloader = createDownloader(createTwoTrackSource(baseUrl, ["video"], AAC_CONTAINER), {
                    output: path.join(directory, "media.ts"),
                    tempDir: directory,
                    muxers: [muxer],
                });

                await downloader.download();

                expect(muxer.requests[0].inputs).toMatchObject([
                    { inputPath: path.join(directory, "media.video.ts") },
                    { inputPath: path.join(directory, "media.audio.aac") },
                ]);
                expect(fs.readFileSync(path.join(directory, "media.mkv"), "utf8")).toBe("video+audio");
            });
        } finally {
            await close(server);
        }
    });

    test("does not mux a track that was split around a dropped item", async () => {
        const server = http.createServer((request, response) => {
            if (request.url === "/video-failed") {
                response.statusCode = 500;
            }
            response.end(request.url!.slice(1));
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-split-muxing-", async (directory) => {
                const output = path.join(directory, "media.ts");
                const muxer = new TestMuxer("available", true);
                const downloader = createDownloader(
                    createTwoTrackSource(baseUrl, ["video-first", "video-failed", "video-second"]),
                    {
                        output,
                        tempDir: directory,
                        taskAttempts: 1,
                        muxers: [muxer],
                    }
                );

                await downloader.download();

                expect(muxer.availabilityChecks).toBe(0);
                expect(downloader.getSnapshot().outputPaths).toEqual([
                    path.join(directory, "media.video_0.ts"),
                    path.join(directory, "media.video_1.ts"),
                    path.join(directory, "media.audio.ts"),
                ]);
                expect(fs.existsSync(output)).toBe(false);
            });
        } finally {
            await close(server);
        }
    });
});

function createTwoTrackSource(
    baseUrl: string,
    videoItems: readonly string[] = ["video"],
    audioContainer?: MediaContainer
): DownloadSource {
    return {
        sourcePath: "custom://muxing",
        continuous: false,
        async prepare() {
            return {
                container: MPEG_TS_CONTAINER,
                tracks: [
                    {
                        id: "video",
                        mediaTrack: { id: "logical-video", type: "video" },
                        sourcePath: `${baseUrl}/video`,
                    },
                    {
                        id: "audio",
                        mediaTrack: { id: "logical-audio", type: "audio" },
                        sourcePath: `${baseUrl}/audio`,
                        ...(audioContainer ? { container: audioContainer } : {}),
                    },
                ],
            };
        },
        async *discover() {
            yield {
                trackId: "video",
                items: videoItems.map((name) => ({ url: `${baseUrl}/${name}`, kind: "media" as const, duration: 1 })),
                totalItemCount: videoItems.length,
            };
            yield {
                trackId: "audio",
                items: [{ url: `${baseUrl}/audio`, kind: "media", duration: 1 }],
                totalItemCount: 1,
            };
        },
    };
}
