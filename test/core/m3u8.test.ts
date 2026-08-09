import { describe, expect, jest, test } from "@jest/globals";
import M3U8, {
    isEncryptedChunk,
    isInitialChunk,
    isNormalChunk,
    MasterPlaylist,
    M3U8ParseError,
    Playlist,
} from "../../src/core/m3u8";
import logger from "../../src/utils/log";

describe("M3U8", () => {
    test("selects the master playlist parser", () => {
        const parsed = new M3U8({
            m3u8Content: [
                "#EXTM3U",
                '#EXT-X-STREAM-INF:BANDWIDTH=1280000,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=29.97',
                "video/720p.m3u8",
                "#EXT-X-STREAM-INF:BANDWIDTH=2560000",
                "https://media.example/high.m3u8",
            ].join("\n"),
            m3u8Url: "https://media.example/master/index.m3u8",
        }).parse();

        expect(parsed).toBeInstanceOf(MasterPlaylist);
        expect((parsed as MasterPlaylist).streams).toEqual([
            {
                url: "https://media.example/master/video/720p.m3u8",
                bandwidth: 1280000,
                codecs: "avc1.4d401f,mp4a.40.2",
                resolution: { width: 1280, height: 720 },
                frameRate: 29.97,
            },
            {
                url: "https://media.example/high.m3u8",
                bandwidth: 2560000,
            },
        ]);
    });

    test("selects the media playlist parser", () => {
        const parsed = new M3U8({
            m3u8Content: ["#EXTM3U", "#EXTINF:1,", "https://media.example/0.ts", "#EXT-X-ENDLIST"].join("\n"),
        }).parse();

        expect(parsed).toBeInstanceOf(Playlist);
    });
});

describe("MasterPlaylist", () => {
    test.each([
        {
            name: "a stream without BANDWIDTH",
            content: ["#EXT-X-STREAM-INF:RESOLUTION=1280x720", "https://media.example/720p.m3u8"].join("\n"),
            expectedMessage: "Missing BANDWIDTH attribute for streams.",
        },
        {
            name: "a stream without a URI",
            content: "#EXT-X-STREAM-INF:BANDWIDTH=1280000\n",
            expectedMessage: "Invalid M3U8 file.",
        },
        {
            name: "a relative stream URI without a playlist URL",
            content: ["#EXT-X-STREAM-INF:BANDWIDTH=1280000", "720p.m3u8"].join("\n"),
            expectedMessage: "Missing full url for M3U8.",
        },
    ])("rejects $name", ({ content, expectedMessage }) => {
        expect(() => new MasterPlaylist({ m3u8Content: content, m3u8Url: "" })).toThrow(
            new M3U8ParseError(expectedMessage)
        );
    });
});

describe("Playlist", () => {
    test("parses sequence, initialization, segment, end, and duration metadata", () => {
        const playlist = new Playlist({
            m3u8Content: [
                "#EXTM3U",
                "#EXT-X-MEDIA-SEQUENCE:41",
                '#EXT-X-MAP:URI="init.mp4"',
                "#EXTINF:4.25,first segment",
                "#EXT-X-BYTERANGE:1000@0",
                "segments/41.m4s",
                "#EXTINF:5.75,second segment",
                "https://cdn.example/42.m4s",
                "#EXT-X-ENDLIST",
                "#EXTINF:10,ignored after end list",
                "segments/43.m4s",
            ].join("\n"),
            m3u8Url: "https://cdn.example/live/playlist.m3u8",
        });

        expect(playlist.chunks).toEqual([
            expect.objectContaining({
                url: "https://cdn.example/live/init.mp4",
                isInitialChunk: true,
                isEncrypted: false,
            }),
            {
                url: "https://cdn.example/live/segments/41.m4s",
                length: 4.25,
                sequenceId: 41,
                isInitialChunk: false,
                isEncrypted: false,
            },
            {
                url: "https://cdn.example/42.m4s",
                length: 5.75,
                sequenceId: 42,
                isInitialChunk: false,
                isEncrypted: false,
            },
        ]);
        expect(playlist.sequenceId).toBe(43);
        expect(playlist.isEnd).toBe(true);
        expect(playlist.getChunkLength()).toBe(5);
        expect(playlist.getTotalChunkLength()).toBe(10);
        expect(playlist.getChunkLength()).toBe(5);
        expect(playlist.getTotalChunkLength()).toBe(10);
    });

    test("applies AES-128 metadata until encryption is disabled", () => {
        const iv = "0000000000000000000000000000000a";
        const playlist = new Playlist({
            m3u8Content: [
                "#EXTM3U",
                "#EXT-X-MEDIA-SEQUENCE:10",
                `#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin",IV=0x${iv}`,
                '#EXT-X-MAP:URI="init.mp4"',
                "#EXTINF:1.5,",
                "10.m4s",
                "#EXT-X-KEY:METHOD=NONE",
                "#EXTINF:2,",
                "11.m4s",
            ].join("\n"),
            m3u8Url: "https://cdn.example/live/playlist.m3u8",
        });

        expect(playlist.encryptKeys).toEqual(["keys/key.bin"]);
        expect(playlist.chunks).toEqual([
            {
                url: "https://cdn.example/live/init.mp4",
                key: "keys/key.bin",
                iv,
                isInitialChunk: true,
                isEncrypted: true,
            },
            {
                url: "https://cdn.example/live/10.m4s",
                length: 1.5,
                key: "keys/key.bin",
                iv,
                sequenceId: 10,
                isInitialChunk: false,
                isEncrypted: true,
            },
            {
                url: "https://cdn.example/live/11.m4s",
                length: 2,
                sequenceId: 11,
                isInitialChunk: false,
                isEncrypted: false,
            },
        ]);
    });

    test("leaves an omitted media IV for the source to derive from its sequence", () => {
        const playlist = new Playlist({
            m3u8Content: [
                "#EXTM3U",
                "#EXT-X-MEDIA-SEQUENCE:7",
                '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
                "#EXTINF:1,",
                "https://cdn.example/7.ts",
            ].join("\n"),
        });

        expect(playlist.chunks[0]).toMatchObject({
            sequenceId: 7,
            key: "key.bin",
            iv: undefined,
            isEncrypted: true,
        });
    });

    test("warns once and treats unsupported encryption methods as plain segments", () => {
        const warning = jest.spyOn(logger, "warning").mockImplementation(() => undefined);
        const playlist = new Playlist({
            m3u8Content: [
                "#EXTM3U",
                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="first.key"',
                "#EXTINF:1,",
                "https://cdn.example/0.ts",
                '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="second.key"',
                "#EXTINF:1,",
                "https://cdn.example/1.ts",
            ].join("\n"),
        });

        expect(playlist.chunks).toHaveLength(2);
        expect(playlist.chunks.every((chunk) => !chunk.isEncrypted)).toBe(true);
        expect(warning).toHaveBeenCalledTimes(1);
        expect(warning).toHaveBeenCalledWith(
            'Unsupported encryption method: "SAMPLE-AES". Chunks will not be decrypted.'
        );
    });

    test("exposes chunk type guards for initial, media, and encrypted chunks", () => {
        const playlist = new Playlist({
            m3u8Content: [
                '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x00000000000000000000000000000001',
                '#EXT-X-MAP:URI="https://cdn.example/init.mp4"',
                "#EXTINF:1,",
                "https://cdn.example/0.m4s",
            ].join("\n"),
        });
        const [initialChunk, mediaChunk] = playlist.chunks;

        expect(isInitialChunk(initialChunk)).toBe(true);
        expect(isNormalChunk(initialChunk)).toBe(false);
        expect(isEncryptedChunk(initialChunk)).toBe(true);
        expect(isInitialChunk(mediaChunk)).toBe(false);
        expect(isNormalChunk(mediaChunk)).toBe(true);
        expect(isEncryptedChunk(mediaChunk)).toBe(true);
    });

    test.each([
        {
            name: "an initialization segment without a URI",
            content: '#EXT-X-MAP:BYTERANGE="100@0"',
            expectedMessage: "Missing URL for initialization segment",
        },
        {
            name: "a relative initialization segment without a playlist URL",
            content: '#EXT-X-MAP:URI="init.mp4"',
            expectedMessage: "Missing full url for M3U8.",
        },
        {
            name: "an encrypted initialization segment without an IV",
            content: ['#EXT-X-KEY:METHOD=AES-128,URI="key.bin"', '#EXT-X-MAP:URI="https://cdn.example/init.mp4"'].join(
                "\n"
            ),
            expectedMessage: "Missing IV for encrypted initialization segment",
        },
        {
            name: "a media tag without a segment URI",
            content: "#EXTINF:1,\n",
            expectedMessage: "Invalid M3U8 file.",
        },
        {
            name: "a relative segment URI without a playlist URL",
            content: ["#EXTINF:1,", "0.ts"].join("\n"),
            expectedMessage: "Missing full url for M3U8.",
        },
    ])("rejects $name", ({ content, expectedMessage }) => {
        expect(() => new Playlist({ m3u8Content: content })).toThrow(new M3U8ParseError(expectedMessage));
    });
});
