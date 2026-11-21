import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { describe, expect, jest, test } from "@jest/globals";
import { createArchiveDownloader } from "@/core/archive";
import { MATROSKA_CONTAINER, MP4_CONTAINER } from "@/core/media_container";
import { Muxer } from "@/core/muxer";
import { withTempDirectory } from "../../../helpers/filesystem";
import { close, listen } from "../../../helpers/http";

const files: Readonly<Record<string, string>> = {
    "/master.m3u8": [
        "#EXTM3U",
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="en.m3u8"',
        '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Japanese",LANGUAGE="ja",FORCED=YES,URI="ja.m3u8"',
        '#EXT-X-STREAM-INF:BANDWIDTH=800000,SUBTITLES="subs"',
        "video.m3u8",
    ].join("\n"),
    "/video.m3u8": "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:41\n#EXTINF:4,\nvideo.ts\n#EXT-X-ENDLIST\n",
    "/en.m3u8": [
        "#EXTM3U",
        "#EXT-X-MEDIA-SEQUENCE:200",
        '#EXT-X-MAP:URI="header.vtt"',
        "#EXTINF:2,",
        "1.vtt",
        "#EXTINF:2,",
        "2.vtt",
        "#EXT-X-ENDLIST",
    ].join("\n"),
    "/ja.m3u8": "#EXTM3U\n#EXTINF:4,\nempty.vtt\n#EXT-X-ENDLIST\n",
    "/video.ts": "video",
    "/header.vtt": "WEBVTT\r\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:01.000\r\n\r\n",
    "/1.vtt": "one\n00:00:02.000 --> 00:00:03.000 align:start\nFirst <00:00:02.500>cue\n\n",
    "/2.vtt":
        "one\n00:00:02.000 --> 00:00:03.000 align:start\nFirst <00:00:02.500>cue\n\n00:04.000 --> 00:05.000\nSecond cue\n",
    "/empty.vtt": "WEBVTT\n\n",
};

async function withSubtitleServer(run: (url: string) => Promise<void>): Promise<void> {
    const server = http.createServer((request, response) => {
        const url = request.url ?? "";
        const file = files[url];
        if (file === undefined) {
            response.writeHead(404).end();
            return;
        }
        response.end(file);
    });
    const url = await listen(server);
    try {
        await run(`${url}/master.m3u8`);
    } finally {
        await close(server);
    }
}

describe("HLS WebVTT subtitle downloads", () => {
    test("assembles mapped cues in a single MKV with video and every selected subtitle", async () => {
        await withSubtitleServer(async (url) => {
            await withTempDirectory("minyami-subtitles-", async (directory) => {
                const unsupported = jest.fn<Muxer["isAvailable"]>().mockResolvedValue(true);
                const mux = jest.fn<Muxer["mux"]>().mockImplementation(async ({ inputs, outputPath }) => {
                    expect(inputs.map(({ mediaTrack }) => mediaTrack.type)).toEqual(["video", "subtitle", "subtitle"]);
                    expect(inputs[2].mediaTrack).toMatchObject({ language: "ja", isForced: true });
                    expect(fs.readFileSync(inputs[0].inputPath, "utf8")).toBe("video");
                    expect(fs.readFileSync(inputs[1].inputPath, "utf8")).toBe(
                        "WEBVTT\n\none\n00:00:11.000 --> 00:00:12.000 align:start\nFirst <00:00:11.500>cue\n\n" +
                            "00:00:13.000 --> 00:00:14.000\nSecond cue\n\n",
                    );
                    expect(fs.readFileSync(inputs[2].inputPath, "utf8")).toBe("WEBVTT\n\n");
                    expect(path.extname(outputPath)).toBe(".mkv");
                    fs.writeFileSync(outputPath, "mux output");
                });
                const downloader = createArchiveDownloader(url, {
                    tempDir: directory,
                    output: path.join(directory, "result.mp4"),
                    streamSelector: (catalog) => catalog.options[0].tracks,
                    muxers: [
                        {
                            name: "mp4",
                            outputContainer: MP4_CONTAINER,
                            preservesTimestamps: true,
                            isAvailable: unsupported,
                            mux,
                        },
                        { name: "mkvmerge", outputContainer: MATROSKA_CONTAINER, isAvailable: unsupported, mux },
                        {
                            name: "mkv",
                            outputContainer: MATROSKA_CONTAINER,
                            preservesTimestamps: true,
                            isAvailable: async () => true,
                            mux,
                        },
                    ],
                });

                await downloader.download();

                expect(mux).toHaveBeenCalledTimes(1);
                expect(unsupported).not.toHaveBeenCalled();
                expect(downloader.getSnapshot().outputPaths).toEqual([path.join(directory, "result.mkv")]);
                expect(fs.readdirSync(directory)).toEqual(["result.mkv"]);
            });
        });
    });

    test("fails muxing without publishing separate files if no MKV muxer is configured", async () => {
        await withSubtitleServer(async (url) => {
            await withTempDirectory("minyami-subtitles-", async (directory) => {
                const downloader = createArchiveDownloader(url, {
                    tempDir: directory,
                    output: path.join(directory, "result"),
                    streamSelector: (catalog) => catalog.options[0].tracks,
                    muxers: [],
                });

                await expect(downloader.download()).rejects.toThrow("MKV subtitle muxing requires FFmpeg");
                expect(fs.readdirSync(directory, { withFileTypes: true }).every((entry) => entry.isDirectory())).toBe(
                    true,
                );
            });
        });
    });
});
