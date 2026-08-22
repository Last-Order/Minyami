import { describe, expect, jest, test } from "@jest/globals";
import { normalizeDownloaderConfig } from "../../../../src/core/download/config";
import { DownloadHttpClient } from "../../../../src/core/download/infrastructure/http_client";
import { KeyStore } from "../../../../src/core/download/infrastructure/key_store";
import { HLSMediaPlaylistCursor } from "../../../../src/core/source/hls/media_playlist_cursor";
import {
    HLSKeyReferenceKind,
    HLSMediaPlaylist,
    HLSPlaylistKind,
    HLSSegmentKind,
} from "../../../../src/core/source/hls/parser";
import { PlaylistLoader } from "../../../../src/core/source/hls/playlist_loader";
import { DownloadSourceContext, SourceBatch } from "../../../../src/core/source/types";

describe("HLSMediaPlaylistCursor", () => {
    test("publishes track metadata and tagged snapshot batches", async () => {
        const context = createContext();
        const cursor = createCursor("video", createPlaylist(), context);
        const signal = new AbortController().signal;

        const track = await cursor.prepare(context, signal);
        const batches = await collect(cursor.discover(context, signal));

        expect(track).toMatchObject({
            id: "video",
            mediaTrack: { id: "logical-video", type: "video" },
            sourcePath: "https://media.example/video.m3u8",
        });
        expect(batches).toEqual([
            {
                trackId: "video",
                items: [
                    {
                        url: "https://media.example/init.mp4",
                        kind: "init",
                        byteRange: { offset: 0, length: 100 },
                    },
                    {
                        url: "https://media.example/segment.m4s",
                        kind: "media",
                        duration: 2,
                        byteRange: { offset: 100, length: 200 },
                    },
                ],
                totalItemCount: 2,
            },
        ]);
    });

    test("keeps identical media-sequence identities isolated between cursors", async () => {
        const context = createContext();
        const signal = new AbortController().signal;
        const video = createCursor("video", createPlaylist(), context, "follow");
        const audio = createCursor("audio", createPlaylist(), context, "follow");
        await video.prepare(context, signal);
        await audio.prepare(context, signal);

        const [videoBatches, audioBatches] = await Promise.all([
            collect(video.discover(context, signal)),
            collect(audio.discover(context, signal)),
        ]);

        expect(videoBatches[0].items).toHaveLength(2);
        expect(audioBatches[0].items).toHaveLength(2);
        expect(videoBatches[0].trackId).toBe("video");
        expect(audioBatches[0].trackId).toBe("audio");
    });

    test("keeps initialization ranges with the same URL as distinct follow items", async () => {
        const context = createContext();
        const playlist: HLSMediaPlaylist = {
            ...createPlaylist(),
            segments: [
                {
                    kind: HLSSegmentKind.Initialization,
                    url: "https://media.example/shared.mp4",
                    byteRange: { offset: 0, length: 100 },
                },
                {
                    kind: HLSSegmentKind.Initialization,
                    url: "https://media.example/shared.mp4",
                    byteRange: { offset: 300, length: 100 },
                },
                {
                    kind: HLSSegmentKind.Initialization,
                    url: "https://media.example/shared.mp4",
                    byteRange: { offset: 0, length: 100 },
                },
            ],
            totalDuration: 0,
            averageSegmentDuration: 0,
        };
        const cursor = createCursor("video", playlist, context, "follow");
        await cursor.prepare(context, new AbortController().signal);

        const batches = await collect(cursor.discover(context, new AbortController().signal));

        expect(batches[0].items).toEqual([
            {
                url: "https://media.example/shared.mp4",
                kind: "init",
                byteRange: { offset: 0, length: 100 },
            },
            {
                url: "https://media.example/shared.mp4",
                kind: "init",
                byteRange: { offset: 300, length: 100 },
            },
        ]);
    });

    test("filters Abema placeholder and advertisement segments after every live refresh", async () => {
        const context = createContext();
        const key = {
            kind: HLSKeyReferenceKind.External,
            id: "abematv-license://asset",
            uri: "abematv-license://asset",
        } as const;
        const createSegment = (url: string, sequenceId: number) => ({
            kind: HLSSegmentKind.Media,
            url,
            duration: 0.001,
            sequenceId,
            encryption: { method: "AES-128" as const, key },
        });
        const initial: HLSMediaPlaylist = {
            kind: HLSPlaylistKind.Media,
            segments: [
                createSegment("https://media.example/tspgsl/0.ts", 0),
                createSegment("https://media.example/content/1.ts", 1),
            ],
            keys: [key],
            hasEndList: false,
            totalDuration: 0.002,
            averageSegmentDuration: 0.001,
        };
        const refreshed: HLSMediaPlaylist = {
            kind: HLSPlaylistKind.Media,
            segments: [
                createSegment("https://media.example/tsad/2.ts", 2),
                createSegment("https://media.example/content/3.ts", 3),
            ],
            keys: [key],
            hasEndList: true,
            totalDuration: 0.002,
            averageSegmentDuration: 0.001,
        };
        const load = jest.spyOn(PlaylistLoader.prototype, "load").mockResolvedValue(refreshed);

        try {
            const cursor = createCursor("video", initial, context, "follow", [{ key: "00".repeat(16) }]);
            await cursor.prepare(context, new AbortController().signal);

            const batches = await collect(cursor.discover(context, new AbortController().signal));

            expect(batches.flatMap((batch) => batch.items.map((item) => item.url))).toEqual([
                "https://media.example/content/1.ts",
                "https://media.example/content/3.ts",
            ]);
            expect(load).toHaveBeenCalledTimes(1);
        } finally {
            load.mockRestore();
        }
    });

    test("does not resolve keys referenced only by filtered site segments", async () => {
        const context = createContext();
        const request = jest.spyOn(context.http, "request");
        const key = {
            kind: HLSKeyReferenceKind.External,
            id: "abematv-license://advertisement",
            uri: "abematv-license://advertisement",
        } as const;
        const playlist: HLSMediaPlaylist = {
            kind: HLSPlaylistKind.Media,
            segments: [
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/tsad/0.ts",
                    duration: 1,
                    sequenceId: 0,
                    encryption: { method: "AES-128", key },
                },
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/content/1.ts",
                    duration: 1,
                    sequenceId: 1,
                },
            ],
            keys: [key],
            hasEndList: true,
            totalDuration: 2,
            averageSegmentDuration: 1,
        };
        const cursor = createCursor("video", playlist, context);

        await cursor.prepare(context, new AbortController().signal);
        const batches = await collect(cursor.discover(context, new AbortController().signal));

        expect(batches[0].items.map((item) => item.url)).toEqual(["https://media.example/content/1.ts"]);
        expect(request).not.toHaveBeenCalled();
    });

    test("keeps the selected SAMPLE-AES profile across a clear-only refresh", async () => {
        const context = createContext();
        const key = {
            kind: HLSKeyReferenceKind.External,
            id: "skd://live-asset",
            uri: "skd://live-asset",
        } as const;
        const initial: HLSMediaPlaylist = {
            kind: HLSPlaylistKind.Media,
            segments: [
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/protected.ts",
                    duration: 0.001,
                    sequenceId: 7,
                    encryption: {
                        method: "SAMPLE-AES",
                        key,
                        iv: "01",
                        keyFormat: "com.apple.streamingkeydelivery",
                    },
                },
            ],
            keys: [key],
            hasEndList: false,
            totalDuration: 0.001,
            averageSegmentDuration: 0.001,
        };
        const refreshed: HLSMediaPlaylist = {
            kind: HLSPlaylistKind.Media,
            segments: [
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/clear.ts",
                    duration: 0.001,
                    sequenceId: 8,
                },
            ],
            keys: [],
            hasEndList: true,
            totalDuration: 0.001,
            averageSegmentDuration: 0.001,
        };
        const load = jest.spyOn(PlaylistLoader.prototype, "load").mockResolvedValue(refreshed);

        try {
            const cursor = createCursor("video", initial, context, "follow", [{ key: "00".repeat(16) }]);
            await cursor.prepare(context, new AbortController().signal);

            const batches = await collect(cursor.discover(context, new AbortController().signal));

            expect(batches.flatMap((batch) => batch.items.map((item) => item.url))).toEqual([
                "https://media.example/protected.ts",
                "https://media.example/clear.ts",
            ]);
            expect(load).toHaveBeenCalledTimes(1);
        } finally {
            load.mockRestore();
        }
    });
});

function createContext(): DownloadSourceContext {
    const http = new DownloadHttpClient(normalizeDownloaderConfig());
    return { http, keys: new KeyStore() };
}

function createCursor(
    id: string,
    playlist: HLSMediaPlaylist,
    context: DownloadSourceContext,
    mode: "snapshot" | "follow" = "snapshot",
    explicitKeys: readonly { readonly key: string }[] = []
): HLSMediaPlaylistCursor {
    return new HLSMediaPlaylistCursor({
        id,
        mediaTrack: { id: `logical-${id}`, type: "video" },
        sourcePath: `https://media.example/${id}.m3u8`,
        mode,
        initialPlaylist: playlist,
        loader: new PlaylistLoader(context.http),
        explicitKeys,
    });
}

function createPlaylist(): HLSMediaPlaylist {
    return {
        kind: HLSPlaylistKind.Media,
        segments: [
            {
                kind: HLSSegmentKind.Initialization,
                url: "https://media.example/init.mp4",
                byteRange: { offset: 0, length: 100 },
            },
            {
                kind: HLSSegmentKind.Media,
                url: "https://media.example/segment.m4s",
                duration: 2,
                sequenceId: 7,
                byteRange: { offset: 100, length: 200 },
            },
        ],
        keys: [],
        hasEndList: true,
        totalDuration: 2,
        averageSegmentDuration: 2,
    };
}

async function collect(iterable: AsyncIterable<SourceBatch>): Promise<SourceBatch[]> {
    const batches: SourceBatch[] = [];
    for await (const batch of iterable) {
        batches.push(batch);
    }
    return batches;
}
