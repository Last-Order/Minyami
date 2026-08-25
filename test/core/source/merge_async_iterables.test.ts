import { describe, expect, test } from "@jest/globals";
import { mergeAsyncIterables } from "@/core/source/merge_async_iterables";

describe("mergeAsyncIterables", () => {
    test("pulls producers concurrently while preserving each producer's order", async () => {
        const started: string[] = [];
        let releaseVideo: () => void = () => undefined;
        const videoGate = new Promise<void>((resolve) => {
            releaseVideo = resolve;
        });
        const video = async function* () {
            started.push("video");
            await videoGate;
            yield "video-1";
            yield "video-2";
        };
        const audio = async function* () {
            started.push("audio");
            yield "audio-1";
            yield "audio-2";
        };

        const values: string[] = [];
        for await (const value of mergeAsyncIterables([video(), audio()])) {
            values.push(value);
            if (value === "audio-1") {
                expect(started).toEqual(["video", "audio"]);
                releaseVideo();
            }
        }

        expect(values.indexOf("audio-1")).toBeLessThan(values.indexOf("video-1"));
        expect(values.filter((value) => value.startsWith("video"))).toEqual(["video-1", "video-2"]);
        expect(values.filter((value) => value.startsWith("audio"))).toEqual(["audio-1", "audio-2"]);
    });

    test("runs the close hook before awaiting sibling cleanup after an error", async () => {
        let releaseSibling: () => void = () => undefined;
        const siblingGate = new Promise<void>((resolve) => {
            releaseSibling = resolve;
        });
        let siblingClosed = false;
        const sibling = async function* () {
            try {
                await siblingGate;
                yield "unused";
            } finally {
                siblingClosed = true;
            }
        };
        const failing = async function* () {
            throw new Error("producer failed");
            yield "unreachable";
        };

        const collect = async () => {
            for await (const _value of mergeAsyncIterables([sibling(), failing()], releaseSibling)) {
                // Nothing should be emitted.
            }
        };

        await expect(collect()).rejects.toThrow("producer failed");
        expect(siblingClosed).toBe(true);
    });
});
