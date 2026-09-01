import { afterEach, describe, expect, jest, test } from "@jest/globals";
import prompts from "prompts";
import { AudioTrack, StreamCatalog, VideoTrack } from "@/core/source/stream_selection";
import { selectStreamInteractively } from "@/core/source/stream_selector";
import logger from "@/utils/log";

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
const englishAudio: AudioTrack = {
    id: "audio-en",
    type: "audio",
    name: "English",
    language: "en",
    channels: 2,
    codecs: ["mp4a.40.2"],
    bandwidth: 128000,
    isDefault: true,
};
const catalog: StreamCatalog = {
    tracks: [lowVideo, highVideo, japaneseAudio, englishAudio],
    options: [
        { id: "low", tracks: [lowVideo, japaneseAudio], bandwidth: 800000 },
        { id: "high", tracks: [highVideo, englishAudio, japaneseAudio], bandwidth: 2400000 },
    ],
};

afterEach(() => {
    delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
    delete (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
});

describe("stream selector", () => {
    test("selects video first and then multiple compatible audio tracks in manifest order", async () => {
        setTTY(true);
        promptMock.mockImplementation(async (question) => {
            const prompt = question as {
                name: string;
                choices: Array<{ value: unknown }>;
            };
            return prompt.name === "video"
                ? { video: prompt.choices[0].value }
                : { audio: [prompt.choices[1].value, prompt.choices[0].value] };
        });

        await expect(selectStreamInteractively(catalog)).resolves.toEqual([highVideo, englishAudio, japaneseAudio]);

        const videoPrompt = promptMock.mock.calls[0][0] as {
            name: string;
            message: string;
            initial: number;
            choices: Array<{ title: string; value: unknown }>;
        };
        expect(videoPrompt.name).toBe("video");
        expect(videoPrompt.message).toBe("Select a video track");
        expect(videoPrompt.initial).toBe(0);
        expect(videoPrompt.choices.map((choice) => choice.title)).toEqual([
            "video: 1920x1080 · 59.94 fps · avc1.640028,mp4a.40.2 · 2.40 Mbps",
            "video: 640x360 · 0.80 Mbps",
        ]);
        expect(catalog.options.map((option) => option.id)).toEqual(["low", "high"]);

        const audioPrompt = promptMock.mock.calls[1][0] as {
            type: string;
            name: string;
            message: string;
            choices: Array<{ title: string; value: unknown; selected: boolean }>;
        };
        expect(audioPrompt.type).toBe("multiselect");
        expect(audioPrompt.name).toBe("audio");
        expect(audioPrompt.message).toBe("Select audio tracks");
        expect(audioPrompt.choices).toEqual([
            {
                title: "English (en) · 2 ch · mp4a.40.2 · 128 kbps",
                value: englishAudio,
                selected: true,
            },
            { title: "Japanese (ja)", value: japaneseAudio, selected: false },
        ]);
    });

    test("allows selecting video without an independent audio track", async () => {
        setTTY(true);
        promptMock.mockImplementation(async (question) => {
            const prompt = question as { name: string; choices: Array<{ value: unknown }> };
            return prompt.name === "video" ? { video: prompt.choices[0].value } : { audio: [] };
        });

        await expect(selectStreamInteractively(catalog)).resolves.toEqual([highVideo]);
    });

    test("offers only audio tracks compatible with the selected video", async () => {
        setTTY(true);
        promptMock.mockImplementation(async (question) => {
            const prompt = question as { name: string; choices: Array<{ value: unknown }> };
            return prompt.name === "video" ? { video: prompt.choices[1].value } : { audio: [prompt.choices[0].value] };
        });

        await expect(selectStreamInteractively(catalog)).resolves.toEqual([lowVideo, japaneseAudio]);

        const audioPrompt = promptMock.mock.calls[1][0] as {
            choices: Array<{ title: string; value: unknown; selected: boolean }>;
        };
        expect(audioPrompt.choices).toEqual([{ title: "Japanese (ja)", value: japaneseAudio, selected: true }]);
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

    test("prompts only for audio when the video choice is unambiguous", async () => {
        setTTY(true);
        const singleVideo = {
            tracks: [highVideo, englishAudio],
            options: [{ id: "high", tracks: [highVideo, englishAudio] }],
        } as StreamCatalog;
        promptMock.mockResolvedValue({ audio: [englishAudio] });

        await expect(selectStreamInteractively(singleVideo)).resolves.toEqual([highVideo, englishAudio]);

        expect(promptMock).toHaveBeenCalledTimes(1);
        expect(promptMock.mock.calls[0][0]).toMatchObject({ name: "audio" });
    });

    test("skips the audio prompt when the selected video has no compatible audio tracks", async () => {
        const videoOnly = {
            tracks: [highVideo],
            options: [{ id: "high", tracks: [highVideo] }],
        } as StreamCatalog;

        await expect(selectStreamInteractively(videoOnly)).resolves.toEqual([highVideo]);
        expect(promptMock).not.toHaveBeenCalled();
    });

    test("returns undefined when video selection is cancelled", async () => {
        setTTY(true);
        promptMock.mockResolvedValue({});

        await expect(selectStreamInteractively(catalog)).resolves.toBeUndefined();
    });

    test("returns undefined when audio selection is cancelled", async () => {
        setTTY(true);
        const singleVideo = {
            tracks: [highVideo, englishAudio],
            options: [{ id: "high", tracks: [highVideo, englishAudio] }],
        } as StreamCatalog;
        promptMock.mockResolvedValue({});

        await expect(selectStreamInteractively(singleVideo)).resolves.toBeUndefined();
    });
});

function setTTY(isTTY: boolean): void {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: isTTY });
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: isTTY });
}
