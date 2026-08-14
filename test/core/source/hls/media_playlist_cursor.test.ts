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

    test("rejects SAMPLE-AES first observed by a live refresh when no manual key was supplied", async () => {
        const context = createContext();
        const initial = { ...createPlaylist(), hasEndList: false, averageSegmentDuration: 0.001 };
        const key = {
            kind: HLSKeyReferenceKind.External,
            id: "skd://live-asset",
            uri: "skd://live-asset",
        } as const;
        const protectedPlaylist: HLSMediaPlaylist = {
            kind: HLSPlaylistKind.Media,
            segments: [
                {
                    kind: HLSSegmentKind.Media,
                    url: "https://media.example/protected.ts",
                    duration: 1,
                    sequenceId: 8,
                    encryption: {
                        method: "SAMPLE-AES",
                        key,
                        iv: "01",
                        keyFormat: "com.apple.streamingkeydelivery",
                    },
                },
            ],
            keys: [key],
            hasEndList: true,
            totalDuration: 1,
            averageSegmentDuration: 1,
        };
        const load = jest.spyOn(PlaylistLoader.prototype, "load").mockResolvedValue(protectedPlaylist);

        try {
            const cursor = createCursor("video", initial, context, "follow");
            await cursor.prepare(context, new AbortController().signal);

            await expect(collect(cursor.discover(context, new AbortController().signal))).rejects.toThrow(
                "Exactly one explicit decryption key is required for SAMPLE-AES HLS."
            );
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
    mode: "snapshot" | "follow" = "snapshot"
): HLSMediaPlaylistCursor {
    return new HLSMediaPlaylistCursor({
        id,
        mediaTrack: { id: `logical-${id}`, type: "video" },
        sourcePath: `https://media.example/${id}.m3u8`,
        mode,
        initialPlaylist: playlist,
        loader: new PlaylistLoader(context.http),
        explicitKeys: [],
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
