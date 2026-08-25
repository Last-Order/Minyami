import { describe, expect, test } from "@jest/globals";
import { mixedItemNamer } from "@/core/download/output/item_naming";

describe("mixedItemNamer", () => {
    test("combines a sortable discovery id with the upstream basename", () => {
        const filename = mixedItemNamer(
            {
                url: "https://example.com/media/segment-42.ts?token=temporary",
                kind: "media",
                duration: 1,
            },
            { taskId: 12, trackId: "video", trackIndex: 7 }
        );

        expect(filename).toBe("000007_segment-42.ts");
    });
});
