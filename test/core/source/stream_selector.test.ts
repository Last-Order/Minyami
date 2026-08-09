import { afterEach, describe, expect, jest, test } from "@jest/globals";
import prompts from "prompts";
import { AudioTrack, StreamCatalog, VideoTrack } from "../../../src/core/source/stream_selection";
import { selectDefaultStream, selectStreamInteractively } from "../../../src/core/source/stream_selector";
import logger from "../../../src/utils/log";

jest.mock("prompts");

const promptMock = jest.mocked(prompts);
const lowVideo: VideoTrack = { id: "video-low", type: "video", width: 640, height: 360 };
const highVideo: VideoTrack = {
    id: "video-high",
    type: "video",
    width: 1920,
    height: 1080,
    frameRate: 59.94,
    codecs: ["avc1.640028", "mp4a.40.2"],
};
const japaneseAudio: AudioTrack = {
    id: "audio-ja",
    type: "audio",
    name: "Japanese",
    language: "ja",
};
const catalog: StreamCatalog = {
    tracks: [lowVideo, highVideo, japaneseAudio],
    options: [
        { id: "low", tracks: [lowVideo], bandwidth: 800000 },
        { id: "high", tracks: [highVideo, japaneseAudio], bandwidth: 2400000 },
    ],
};

afterEach(() => {
    delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
    delete (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
});

describe("stream selector", () => {
    test("sorts and formats compatible options without changing catalog order", async () => {
        setTTY(true);
        promptMock.mockResolvedValue({ option: catalog.options[0] });

        await expect(selectStreamInteractively(catalog)).resolves.toBe(catalog.options[0].tracks);

        const prompt = promptMock.mock.calls[0][0] as {
            initial: number;
            choices: Array<{ title: string; value: unknown }>;
        };
        expect(prompt.initial).toBe(0);
        expect(prompt.choices.map((choice) => choice.value)).toEqual([catalog.options[1], catalog.options[0]]);
        expect(catalog.options.map((option) => option.id)).toEqual(["low", "high"]);
        expect(prompt.choices[0]).toEqual({
            title: "video: 1920x1080 59.94 fps avc1.640028,mp4a.40.2 | audio: Japanese (ja) | 2.40 Mbps",
            value: catalog.options[1],
        });
        expect(prompt.choices[1]).toEqual({
            title: "video: 640x360 | 0.80 Mbps",
            value: catalog.options[0],
        });
    });

    test("falls back to the highest-bandwidth option outside a TTY", async () => {
        setTTY(false);
        const warning = jest.spyOn(logger, "warning").mockImplementation(() => undefined);

        await expect(selectStreamInteractively(catalog)).resolves.toBe(catalog.options[1].tracks);

        expect(warning).toHaveBeenCalledWith(
            "Interactive stream selection is unavailable. Selecting the highest-bandwidth option."
        );
    });

    test("selects a sole option without prompting", async () => {
        const single = {
            tracks: [japaneseAudio],
            options: [{ id: "audio", tracks: [japaneseAudio] }],
        } as StreamCatalog;

        await expect(selectStreamInteractively(single)).resolves.toEqual([japaneseAudio]);
        expect(promptMock).not.toHaveBeenCalled();
    });

    test("returns undefined when the interactive prompt is cancelled", async () => {
        setTTY(true);
        promptMock.mockResolvedValue({});

        await expect(selectStreamInteractively(catalog)).resolves.toBeUndefined();
    });

    test("the non-interactive default selects the highest-bandwidth option", () => {
        expect(selectDefaultStream(catalog)).toBe(catalog.options[1].tracks);
    });
});

function setTTY(isTTY: boolean): void {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: isTTY });
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: isTTY });
}
