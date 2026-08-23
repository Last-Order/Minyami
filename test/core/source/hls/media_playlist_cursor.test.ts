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
            container: { name: "MP4", extension: "mp4" },
            track: {
                id: "video",
                mediaTrack: { id: "logical-video", type: "video" },
                sourcePath: "https://media.example/video.m3u8",
            },
        });
        expect(batches).toEqual([
            {
                trackId: "video",
                items: [
                    {
                        url: "https://media.example/init.mp4",
                        kind: "init",
                        byteRange: { offset: 0, length: 100 },
                        output: {
                            replayablePrefix: { slot: "hls-map", identity: "init-a" },
                            startsNewRun: true,
                        },
                    },
                    {
                        url: "https://media.example/segment.m4s",
                        kind: "media",
                        duration: 2,
                        byteRange: { offset: 100, length: 200 },
                        output: { requiredPrefixes: [{ slot: "hls-map", identity: "init-a" }] },
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

    test("re-publishes an earlier initialization range after the active context changes", async () => {
        const context = createContext();
        const playlist: HLSMediaPlaylist = {
            ...createPlaylist(),
            segments: [
                {
                    kind: HLSSegmentKind.Initialization,
                    initializationId: "shared-0",
                    url: "https://media.example/shared.mp4",
                    byteRange: { offset: 0, length: 100 },
                },
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/0.m4s",
                    duration: 0.001,
                    sequenceId: 0,
                    initializationId: "shared-0",
                },
                {
                    kind: HLSSegmentKind.Initialization,
                    initializationId: "shared-300",
                    url: "https://media.example/shared.mp4",
                    byteRange: { offset: 300, length: 100 },
                },
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/1.m4s",
                    duration: 0.001,
                    sequenceId: 1,
                    initializationId: "shared-300",
                },
                {
                    kind: HLSSegmentKind.Initialization,
                    initializationId: "shared-0",
                    url: "https://media.example/shared.mp4",
                    byteRange: { offset: 0, length: 100 },
                },
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/2.m4s",
                    duration: 0.001,
                    sequenceId: 2,
                    initializationId: "shared-0",
                },
            ],
            totalDuration: 0.003,
            averageSegmentDuration: 0.001,
        };
        const cursor = createCursor("video", playlist, context, "follow");
        await cursor.prepare(context, new AbortController().signal);

        const batches = await collect(cursor.discover(context, new AbortController().signal));

        expect(outputContexts(batches)).toEqual([
            [
                "init:shared-0",
                "media:shared-0",
                "init:shared-300",
                "media:shared-300",
                "init:shared-0",
                "media:shared-0",
            ],
        ]);
    });

    test("re-publishes A after A to B to A transitions across live refreshes", async () => {
        const context = createContext();
        const initA = createInitialization("init-a");
        const initB = createInitialization("init-b");
        const mediaA0 = createMedia(0, "init-a");
        const mediaB1 = createMedia(1, "init-b");
        const mediaA2 = createMedia(2, "init-a");
        const initial = createLivePlaylist([initA, mediaA0], false);
        const refreshedB = createLivePlaylist([initA, mediaA0, initB, mediaB1], false);
        const refreshedA = createLivePlaylist([initA, mediaA0, initB, mediaB1, initA, mediaA2], true);
        const load = jest
            .spyOn(PlaylistLoader.prototype, "load")
            .mockResolvedValueOnce(refreshedB)
            .mockResolvedValueOnce(refreshedA);

        try {
            const cursor = createCursor("video", initial, context, "follow");
            await cursor.prepare(context, new AbortController().signal);

            const batches = await collect(cursor.discover(context, new AbortController().signal));

            expect(outputContexts(batches)).toEqual([
                ["init:init-a", "media:init-a"],
                ["init:init-b", "media:init-b"],
                ["init:init-a", "media:init-a"],
            ]);
            expect(load).toHaveBeenCalledTimes(2);
        } finally {
            load.mockRestore();
        }
    });

    test("does not re-publish an unchanged initialization context on refresh", async () => {
        const context = createContext();
        const initA = createInitialization("init-a");
        const mediaA0 = createMedia(0, "init-a");
        const mediaA1 = createMedia(1, "init-a");
        const initial = createLivePlaylist([initA, mediaA0], false);
        const refreshed = createLivePlaylist([initA, mediaA0, mediaA1], true);
        const load = jest.spyOn(PlaylistLoader.prototype, "load").mockResolvedValue(refreshed);

        try {
            const cursor = createCursor("video", initial, context, "follow");
            await cursor.prepare(context, new AbortController().signal);

            const batches = await collect(cursor.discover(context, new AbortController().signal));

            expect(outputContexts(batches)).toEqual([["init:init-a", "media:init-a"], ["media:init-a"]]);
            expect(load).toHaveBeenCalledTimes(1);
        } finally {
            load.mockRestore();
        }
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
                initializationId: "init-a",
                url: "https://media.example/init.mp4",
                byteRange: { offset: 0, length: 100 },
            },
            {
                kind: HLSSegmentKind.Media,
                url: "https://media.example/segment.m4s",
                duration: 2,
                sequenceId: 7,
                initializationId: "init-a",
                byteRange: { offset: 100, length: 200 },
            },
        ],
        keys: [],
        hasEndList: true,
        totalDuration: 2,
        averageSegmentDuration: 2,
    };
}

function createInitialization(initializationId: string) {
    return {
        kind: HLSSegmentKind.Initialization,
        initializationId,
        url: `https://media.example/${initializationId}.mp4`,
    } as const;
}

function createMedia(sequenceId: number, initializationId: string) {
    return {
        kind: HLSSegmentKind.Media,
        url: `https://media.example/${sequenceId}.m4s`,
        duration: 0.001,
        sequenceId,
        initializationId,
    } as const;
}

function createLivePlaylist(segments: HLSMediaPlaylist["segments"], hasEndList: boolean): HLSMediaPlaylist {
    const mediaCount = segments.filter((segment) => segment.kind === HLSSegmentKind.Media).length;
    return {
        kind: HLSPlaylistKind.Media,
        segments,
        keys: [],
        hasEndList,
        totalDuration: mediaCount * 0.001,
        averageSegmentDuration: mediaCount === 0 ? 0 : 0.001,
    };
}

function outputContexts(batches: readonly SourceBatch[]): string[][] {
    return batches.map((batch) =>
        batch.items.map((item) => {
            if (item.kind === "init") {
                return `init:${item.output?.replayablePrefix?.identity}`;
            }
            return `media:${item.output?.requiredPrefixes?.[0]?.identity}`;
        })
    );
}

async function collect(iterable: AsyncIterable<SourceBatch>): Promise<SourceBatch[]> {
    const batches: SourceBatch[] = [];
    for await (const batch of iterable) {
        batches.push(batch);
    }
    return batches;
}
