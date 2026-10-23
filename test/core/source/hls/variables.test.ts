import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { createDownloader } from "@/core/download/downloader";
import { createHLSSource } from "@/core/source/hls";
import { withTempDirectory } from "../../../helpers/filesystem";
import { close, listen } from "../../../helpers/http";

describe("HLS variable discovery", () => {
    test.each(["snapshot", "follow"] as const)(
        "downloads independent video and audio tracks with imported variables in %s mode",
        async (mode) => {
            const requests: string[] = [];
            const refreshes = new Map<string, number>();
            const server = http.createServer((request, response) => {
                const requestPath = request.url!;
                requests.push(requestPath);
                if (requestPath === "/start.m3u8?session=old") {
                    response.writeHead(302, { location: "/manifest/master.m3u8?session=abc%2B123" });
                    response.end();
                    return;
                }
                if (requestPath === "/manifest/master.m3u8?session=abc%2B123") {
                    response.end(
                        [
                            "#EXTM3U",
                            '#EXT-X-DEFINE:QUERYPARAM="session"',
                            `#EXT-X-DEFINE:NAME="manifestPrefix",VALUE="${baseUrl}/playlists/"`,
                            `#EXT-X-DEFINE:NAME="mediaPrefix",VALUE="${baseUrl}/media/"`,
                            '#EXT-X-DEFINE:NAME="query",VALUE="cSig=none"',
                            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="EN",DEFAULT=YES,URI="{$manifestPrefix}audio.m3u8?asid={$session}"',
                            '#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,AUDIO="audio"',
                            "{$manifestPrefix}video.m3u8?asid={$session}",
                        ].join("\n"),
                    );
                    return;
                }
                const mediaPlaylist = requestPath.match(/^\/playlists\/(video|audio)\.m3u8\?asid=abc\+123$/);
                if (mediaPlaylist) {
                    const track = mediaPlaylist[1];
                    const refresh = (refreshes.get(track) ?? 0) + 1;
                    refreshes.set(track, refresh);
                    const extension = track === "video" ? "ts" : "aac";
                    response.end(
                        [
                            "#EXTM3U",
                            '#EXT-X-DEFINE:IMPORT="mediaPrefix"',
                            '#EXT-X-DEFINE:IMPORT="session"',
                            '#EXT-X-DEFINE:IMPORT="query"',
                            `#EXT-X-DEFINE:NAME="prefix",VALUE="{$mediaPrefix}${track}/${refresh}/"`,
                            `#EXT-X-MEDIA-SEQUENCE:${refresh}`,
                            "#EXTINF:0.001,",
                            `{$prefix}segment.${extension}?asid={$session}&{$query}`,
                            ...(mode === "snapshot" || refresh === 2 ? ["#EXT-X-ENDLIST"] : []),
                        ].join("\n"),
                    );
                    return;
                }
                const segment = requestPath.match(
                    /^\/media\/(video|audio)\/([12])\/segment\.(ts|aac)\?asid=abc\+123&cSig=none$/,
                );
                if (segment) {
                    response.end(`${segment[1]}-${segment[2]}`);
                    return;
                }
                response.writeHead(404);
                response.end();
            });
            const baseUrl = await listen(server);

            try {
                await withTempDirectory("minyami-hls-variables-", async (directory) => {
                    const source = createHLSSource(`${baseUrl}/start.m3u8?session=old`, { mode });
                    const downloader = createDownloader(source, {
                        output: path.join(directory, "episode"),
                        tempDir: directory,
                        muxers: [],
                    });

                    await downloader.download();

                    const snapshot = downloader.getSnapshot();
                    const count = mode === "snapshot" ? 1 : 2;
                    expect(snapshot).toMatchObject({ status: "finished", successfulChunkCount: count * 2 });
                    expect(snapshot.outputPaths.map((file) => fs.readFileSync(file, "utf8"))).toEqual([
                        count === 1 ? "video-1" : "video-1video-2",
                        count === 1 ? "audio-1" : "audio-1audio-2",
                    ]);
                    expect(snapshot.outputPaths.map((file) => path.extname(file))).toEqual([".ts", ".aac"]);
                    expect(refreshes).toEqual(
                        new Map([
                            ["video", count],
                            ["audio", count],
                        ]),
                    );
                    expect(requests).toEqual(
                        expect.arrayContaining([
                            "/media/video/1/segment.ts?asid=abc+123&cSig=none",
                            "/media/audio/1/segment.aac?asid=abc+123&cSig=none",
                        ]),
                    );
                });
            } finally {
                await close(server);
            }
        },
    );

    test("does not retain a media variable when the next live snapshot omits its declaration", async () => {
        let refreshes = 0;
        const server = http.createServer((request, response) => {
            if (request.url === "/0.ts") {
                response.end("first");
                return;
            }
            refreshes++;
            response.end(
                [
                    "#EXTM3U",
                    ...(refreshes === 1 ? ['#EXT-X-DEFINE:NAME="prefix",VALUE="/"'] : []),
                    `#EXT-X-MEDIA-SEQUENCE:${refreshes}`,
                    "#EXTINF:0.001,",
                    `{$prefix}${refreshes - 1}.ts`,
                ].join("\n"),
            );
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-hls-variable-refresh-", async (directory) => {
                const downloader = createDownloader(createHLSSource(`${baseUrl}/live.m3u8`, { mode: "follow" }), {
                    output: path.join(directory, "live"),
                    tempDir: directory,
                });

                await expect(downloader.download()).rejects.toThrow("Undefined HLS variable: prefix.");
                expect(refreshes).toBe(2);
            });
        } finally {
            await close(server);
        }
    });

    test("loads a local master with variables and downloads its imported media references", async () => {
        const server = http.createServer((request, response) => {
            if (request.url === "/0.ts?session=local") {
                response.end("local-master");
                return;
            }
            response.end(
                ['#EXT-X-DEFINE:IMPORT="session"', "#EXTINF:1,", "0.ts?session={$session}", "#EXT-X-ENDLIST"].join(
                    "\n",
                ),
            );
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-local-hls-variables-", async (directory) => {
                const input = path.join(directory, "master.m3u8");
                fs.writeFileSync(
                    input,
                    [
                        '#EXT-X-DEFINE:NAME="session",VALUE="local"',
                        `#EXT-X-DEFINE:NAME="prefix",VALUE="${baseUrl}/"`,
                        "#EXT-X-STREAM-INF:BANDWIDTH=1000",
                        "{$prefix}media.m3u8",
                    ].join("\n"),
                );
                const output = path.join(directory, "output.ts");
                const downloader = createDownloader(createHLSSource(input, { mode: "snapshot" }), {
                    output,
                    tempDir: directory,
                });

                await downloader.download();

                expect(fs.readFileSync(output, "utf8")).toBe("local-master");
            });
        } finally {
            await close(server);
        }
    });
});
