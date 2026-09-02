import * as crypto from "crypto";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { createDownloader } from "@/core/download/downloader";
import { createHLSSource } from "@/core/source/hls";
import { withTempDirectory } from "../../../helpers/filesystem";
import { close, listen } from "../../../helpers/http";

const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const iv = Buffer.from("ffeeddccbbaa99887766554433221100", "hex");

describe("Packed AAC SAMPLE-AES HLS", () => {
    test("downloads mixed MPEG-TS video and Packed AAC audio into correctly typed track artifacts", async () => {
        const video = Buffer.from("clear MPEG-TS fixture");
        const metadata = Buffer.concat([
            createId3Tag(Buffer.from("com.apple.streaming.transportStreamTimestamp")),
            createId3Tag(Buffer.from("com.apple.streaming.audioDescription")),
        ]);
        const firstFrame = createAdtsFrame(87, 3);
        const secondFrame = createAdtsFrame(103, 7);
        const clearAudio = Buffer.concat([metadata, firstFrame, secondFrame]);
        const encryptedAudio = Buffer.concat([metadata, encryptAdtsFrame(firstFrame), encryptAdtsFrame(secondFrame)]);
        const server = http.createServer((request, response) => {
            switch (request.url) {
                case "/master.m3u8":
                    response.end(
                        [
                            "#EXTM3U",
                            '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Main",DEFAULT=YES,AUTOSELECT=YES,URI="/audio.m3u8"',
                            '#EXT-X-STREAM-INF:BANDWIDTH=1000000,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="audio"',
                            "/video.m3u8",
                        ].join("\n"),
                    );
                    break;
                case "/video.m3u8":
                    response.end(["#EXTM3U", "#EXTINF:1,", "/video.ts", "#EXT-X-ENDLIST"].join("\n"));
                    break;
                case "/audio.m3u8":
                    response.end(
                        [
                            "#EXTM3U",
                            `#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://asset",KEYFORMAT="com.apple.streamingkeydelivery",IV=0x${iv.toString(
                                "hex",
                            )}`,
                            "#EXTINF:1,",
                            "/audio.aac",
                            "#EXT-X-ENDLIST",
                        ].join("\n"),
                    );
                    break;
                case "/video.ts":
                    response.setHeader("content-type", "video/mp2t");
                    response.end(video);
                    break;
                case "/audio.aac":
                    response.setHeader("content-type", "audio/aac");
                    response.end(encryptedAudio);
                    break;
                default:
                    response.writeHead(404).end();
            }
        });
        const baseUrl = await listen(server);

        try {
            await withTempDirectory("minyami-packed-aac-hls-", async (directory) => {
                const downloader = createDownloader(
                    createHLSSource(`${baseUrl}/master.m3u8`, {
                        mode: "snapshot",
                        explicitKeys: [{ key: key.toString("hex") }],
                    }),
                    {
                        output: path.join(directory, "media.ts"),
                        tempDir: directory,
                        muxers: [],
                    },
                );

                await downloader.download();

                const videoOutput = path.join(directory, "media.video-1.ts");
                const audioOutput = path.join(directory, "media.audio-1.aac");
                expect(fs.readFileSync(videoOutput)).toEqual(video);
                expect(fs.readFileSync(audioOutput)).toEqual(clearAudio);
                expect(downloader.getSnapshot()).toMatchObject({
                    status: "finished",
                    successfulChunkCount: 2,
                    droppedChunkCount: 0,
                    outputPaths: [videoOutput, audioOutput],
                });
            });
        } finally {
            await close(server);
        }
    });
});

function createId3Tag(body: Buffer): Buffer {
    return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, body.length]), body]);
}

function createAdtsFrame(length: number, seed: number): Buffer {
    const frame = Buffer.alloc(length);
    frame[0] = 0xff;
    frame[1] = 0xf1;
    frame[2] = 0x4c;
    frame[3] = 0x80 | ((length >> 11) & 3);
    frame[4] = (length >> 3) & 0xff;
    frame[5] = ((length & 7) << 5) | 0x1f;
    frame[6] = 0xfc;
    for (let index = 7; index < frame.length; index++) {
        frame[index] = (index * seed + 13) & 0xff;
    }
    return frame;
}

function encryptAdtsFrame(clear: Buffer): Buffer {
    const encrypted = Buffer.from(clear);
    const encryptedOffset = 7 + 16;
    const encryptedLength = Math.floor((clear.length - encryptedOffset) / 16) * 16;
    const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
    cipher.setAutoPadding(false);
    const ciphertext = Buffer.concat([
        cipher.update(clear.subarray(encryptedOffset, encryptedOffset + encryptedLength)),
        cipher.final(),
    ]);
    ciphertext.copy(encrypted, encryptedOffset);
    return encrypted;
}
