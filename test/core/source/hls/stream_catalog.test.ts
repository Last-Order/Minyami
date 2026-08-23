import { describe, expect, test } from "@jest/globals";
import { parseMasterPlaylist } from "../../../../src/core/source/hls/playlist/master";
import { createHLSStreamCatalogPlan } from "../../../../src/core/source/hls/stream_catalog";

describe("HLS stream catalog", () => {
    test("normalizes compatible tracks while keeping playlist URLs private", () => {
        const master = parseMasterPlaylist({
            content: [
                "#EXTM3U",
                '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="en.m3u8"',
                '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Muxed",LANGUAGE="ja",DEFAULT=NO,AUTOSELECT=YES',
                '#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="audio",CODECS="avc1.low,mp4a.40.2",RESOLUTION=640x360',
                "low.m3u8",
                '#EXT-X-STREAM-INF:BANDWIDTH=2400000,AUDIO="audio",CODECS="avc1.high,mp4a.40.2",RESOLUTION=1920x1080',
                "high.m3u8",
            ].join("\n"),
            playlistUrl: "https://media.example/master.m3u8",
        });

        const plan = createHLSStreamCatalogPlan(master);

        expect(plan.catalog.tracks).toEqual([
            {
                id: "video-1",
                type: "video",
                bandwidth: 800000,
                codecs: ["avc1.low", "mp4a.40.2"],
                width: 640,
                height: 360,
            },
            {
                id: "audio-1",
                type: "audio",
                name: "English",
                language: "en",
                isDefault: true,
            },
            {
                id: "video-2",
                type: "video",
                bandwidth: 2400000,
                codecs: ["avc1.high", "mp4a.40.2"],
                width: 1920,
                height: 1080,
            },
        ]);
        expect(plan.catalog.options.map((option) => option.tracks.map((track) => track.id))).toEqual([
            ["video-1", "audio-1"],
            ["video-2", "audio-1"],
        ]);
        expect(Object.isFrozen(plan.catalog)).toBe(true);
        expect(Object.isFrozen(plan.catalog.options[0].tracks)).toBe(true);
        expect(plan.catalog.tracks.every(Object.isFrozen)).toBe(true);
        expect(plan.catalog.tracks.every((track) => !("url" in track))).toBe(true);
        expect(plan.catalog.tracks.map((track) => plan.mediaTracks.get(track)?.sourcePath)).toEqual([
            "https://media.example/low.m3u8",
            "https://media.example/en.m3u8",
            "https://media.example/high.m3u8",
        ]);
    });

    test("classifies a codec-declared audio-only variant without requiring a video track", () => {
        const master = parseMasterPlaylist({
            content: [
                "#EXTM3U",
                '#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"',
                "https://media.example/audio.m3u8",
            ].join("\n"),
        });

        const plan = createHLSStreamCatalogPlan(master);

        expect(plan.catalog.options[0].tracks).toEqual([
            {
                id: "audio-primary-1",
                type: "audio",
                bandwidth: 128000,
                codecs: ["mp4a.40.2"],
            },
        ]);
    });
});
