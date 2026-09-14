import { describe, expect, test } from "@jest/globals";
import { selectDefaultStream } from "@/core/source/default_stream_selector";
import { StreamCatalog, VideoTrack } from "@/core/source/stream_selection";

const lowVideo: VideoTrack = { id: "low", type: "video", bandwidth: 800_000 };
const highVideo: VideoTrack = { id: "high", type: "video", bandwidth: 2_400_000 };

describe("default stream selector", () => {
    test("selects the highest-bandwidth option without changing catalog order", () => {
        const catalog: StreamCatalog = {
            tracks: [lowVideo, highVideo],
            options: [
                { id: "low", tracks: [lowVideo] },
                { id: "high", tracks: [highVideo] },
            ],
        };

        expect(selectDefaultStream(catalog)).toBe(catalog.options[1].tracks);
        expect(catalog.options.map((option) => option.id)).toEqual(["low", "high"]);
    });

    test("returns undefined for an empty catalog", () => {
        expect(selectDefaultStream({ tracks: [], options: [] })).toBeUndefined();
    });
});
