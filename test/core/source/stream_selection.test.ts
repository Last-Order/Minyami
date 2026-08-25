import { describe, expect, test } from "@jest/globals";
import { AudioTrack, StreamCatalog, VideoTrack, validateTrackSelection } from "@/core/source/stream_selection";

const videoA: VideoTrack = { id: "video-a", type: "video" };
const videoB: VideoTrack = { id: "video-b", type: "video" };
const audio: AudioTrack = { id: "audio", type: "audio" };
const catalog: StreamCatalog = {
    tracks: [videoA, videoB, audio],
    options: [
        { id: "a", tracks: [videoA, audio] },
        { id: "b", tracks: [videoB] },
    ],
};

describe("validateTrackSelection", () => {
    test("accepts a non-empty subset of one compatible option and preserves its order", () => {
        const selection = [audio, videoA] as const;
        expect(validateTrackSelection(catalog, selection)).toBe(selection);
        expect(validateTrackSelection(catalog, [audio])).toEqual([audio]);
    });

    test.each([
        {
            name: "an empty result",
            selection: [],
            message: "empty track selection",
        },
        {
            name: "a copied track",
            selection: [{ ...videoA }],
            message: "not offered",
        },
        {
            name: "a duplicate track",
            selection: [videoA, videoA],
            message: "duplicate track",
        },
        {
            name: "tracks crossing compatibility options",
            selection: [videoB, audio],
            message: "one compatible stream option",
        },
    ])("rejects $name", ({ selection, message }) => {
        expect(() => validateTrackSelection(catalog, selection)).toThrow(message);
    });
});
