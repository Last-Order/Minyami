import { describe, expect, test } from "@jest/globals";
import { createDefaultMuxers, ExecutableRunner, FFmpegMuxer, MkvmergeMuxer, selectAvailableMuxer } from "@/core/muxer";

class RecordingRunner implements ExecutableRunner {
    readonly availabilityChecks: { command: string; arguments_: readonly string[] }[] = [];
    readonly runs: { command: string; arguments_: readonly string[] }[] = [];

    constructor(private readonly availableCommands: readonly string[]) {}

    async isAvailable(command: string, arguments_: readonly string[]): Promise<boolean> {
        this.availabilityChecks.push({ command, arguments_ });
        return this.availableCommands.includes(command);
    }

    async run(command: string, arguments_: readonly string[]): Promise<void> {
        this.runs.push({ command, arguments_ });
    }
}

const request = {
    inputs: [
        {
            trackId: "video",
            mediaTrack: { id: "logical-video", type: "video" as const },
            inputPath: "video track.ts",
        },
        {
            trackId: "audio",
            mediaTrack: { id: "logical-audio", type: "audio" as const },
            inputPath: "audio track.ts",
        },
    ],
    outputPath: "mixed output.mkv",
};

describe("built-in muxers", () => {
    test("registers mkvmerge ahead of ffmpeg by default", () => {
        expect(createDefaultMuxers().map((muxer) => muxer.name)).toEqual(["mkvmerge", "ffmpeg"]);
        expect(createDefaultMuxers().map((muxer) => muxer.outputContainer.extension)).toEqual(["mkv", "mp4"]);
    });

    test("mkvmerge passes paths as direct process arguments", async () => {
        const runner = new RecordingRunner(["mkvmerge"]);
        const muxer = new MkvmergeMuxer(runner);

        await expect(muxer.isAvailable()).resolves.toBe(true);
        await muxer.mux(request);

        expect(runner.availabilityChecks).toEqual([{ command: "mkvmerge", arguments_: ["--version"] }]);
        expect(runner.runs).toEqual([
            {
                command: "mkvmerge",
                arguments_: ["--output", "mixed output.mkv", "video track.ts", "audio track.ts"],
            },
        ]);
    });

    test("ffmpeg maps every input stream and copies codecs", async () => {
        const runner = new RecordingRunner(["ffmpeg"]);
        const muxer = new FFmpegMuxer(runner);
        const ffmpegRequest = { ...request, outputPath: "mixed output.mp4" };

        await expect(muxer.isAvailable()).resolves.toBe(true);
        await muxer.mux(ffmpegRequest);

        expect(runner.availabilityChecks).toEqual([{ command: "ffmpeg", arguments_: ["-version"] }]);
        expect(runner.runs).toEqual([
            {
                command: "ffmpeg",
                arguments_: [
                    "-nostdin",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-n",
                    "-i",
                    "video track.ts",
                    "-i",
                    "audio track.ts",
                    "-map",
                    "0",
                    "-map",
                    "1",
                    "-c",
                    "copy",
                    "-movflags",
                    "+faststart",
                    "mixed output.mp4",
                ],
            },
        ]);
    });

    test("selects the first available candidate in priority order", async () => {
        const runner = new RecordingRunner(["ffmpeg"]);
        const mkvmerge = new MkvmergeMuxer(runner);
        const ffmpeg = new FFmpegMuxer(runner);

        await expect(selectAvailableMuxer([mkvmerge, ffmpeg])).resolves.toBe(ffmpeg);
        expect(runner.availabilityChecks.map((check) => check.command)).toEqual(["mkvmerge", "ffmpeg"]);
    });
});
