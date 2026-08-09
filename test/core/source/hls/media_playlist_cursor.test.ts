import { describe, expect, test } from "@jest/globals";
import { normalizeDownloaderConfig } from "../../../../src/core/download/config";
import { DownloadHttpClient } from "../../../../src/core/download/http_client";
import { KeyStore } from "../../../../src/core/download/key_store";
import { HLSMediaPlaylistCursor } from "../../../../src/core/source/hls/media_playlist_cursor";
import { HLSMediaPlaylist, HLSPlaylistKind, HLSSegmentKind } from "../../../../src/core/source/hls/parser";
import { PlaylistLoader } from "../../../../src/core/source/hls/playlist_loader";
import { DownloadSourceContext, SourceBatch } from "../../../../src/core/source/types";

describe("HLSMediaPlaylistCursor", () => {
    test("publishes track metadata and tagged snapshot batches", async () => {
        const context = createContext();
        const cursor = createCursor("video", createPlaylist(), context);
        const signal = new AbortController().signal;

        const track = await cursor.prepare(context, signal);
        const batches = await collect(cursor.discover(context, signal));

        expect(track).toMatchObject({ id: "video", sourcePath: "https://media.example/video.m3u8" });
        expect(batches).toEqual([
            {
                trackId: "video",
                items: [
                    { url: "https://media.example/init.mp4", kind: "init" },
                    { url: "https://media.example/segment.m4s", kind: "media", duration: 2 },
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
});

function createContext(): DownloadSourceContext {
    const http = new DownloadHttpClient(normalizeDownloaderConfig());
    return { http, keys: new KeyStore(), retries: 1 };
}

function createCursor(
    id: string,
    playlist: HLSMediaPlaylist,
    context: DownloadSourceContext,
    mode: "snapshot" | "follow" = "snapshot"
): HLSMediaPlaylistCursor {
    return new HLSMediaPlaylistCursor({
        track: { id, type: "video" },
        sourcePath: `https://media.example/${id}.m3u8`,
        mode,
        initialPlaylist: playlist,
        loader: new PlaylistLoader(context.http),
    });
}

function createPlaylist(): HLSMediaPlaylist {
    return {
        kind: HLSPlaylistKind.Media,
        segments: [
            { kind: HLSSegmentKind.Initialization, url: "https://media.example/init.mp4" },
            {
                kind: HLSSegmentKind.Media,
                url: "https://media.example/segment.m4s",
                duration: 2,
                sequenceId: 7,
            },
        ],
        encryptionKeyUrls: [],
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
