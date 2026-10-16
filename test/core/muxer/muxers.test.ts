import { describe, expect, jest, test } from "@jest/globals";
import { createDefaultMuxers, ExecutableRunner, FFmpegMuxer, MkvmergeMuxer, selectAvailableMuxer } from "@/core/muxer";
import { ExecutableExitError } from "@/core/muxer/executable_runner";
import logger from "@/utils/log";

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
            trackId: "audio-en",
            mediaTrack: { id: "logical-audio-en", type: "audio" as const },
            inputPath: "english audio track.ts",
        },
        {
            trackId: "audio-ja",
            mediaTrack: { id: "logical-audio-ja", type: "audio" as const },
            inputPath: "japanese audio track.ts",
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
                arguments_: [
                    "--quiet",
                    "--output",
                    "mixed output.mkv",
                    "video track.ts",
                    "english audio track.ts",
                    "japanese audio track.ts",
                ],
            },
        ]);
    });

    test("reports mkvmerge warnings without rejecting completed muxing", async () => {
        const runner = new RecordingRunner(["mkvmerge"]);
        jest.spyOn(runner, "run").mockRejectedValue(
            new ExecutableExitError("mkvmerge", 1, "Warning: check timestamps"),
        );
        const warning = jest.spyOn(logger, "warning").mockImplementation(() => undefined);

        await expect(new MkvmergeMuxer(runner).mux(request)).resolves.toBeUndefined();
        expect(warning).toHaveBeenCalledWith(expect.stringContaining("Warning: check timestamps"));
    });

    test.each([
        new ExecutableExitError("mkvmerge", 2, "Invalid input"),
        new ExecutableExitError("mkvmerge", null, "Process terminated"),
        new Error("Executable could not be started"),
    ])("preserves mkvmerge process failures: %s", async (failure) => {
        const runner = new RecordingRunner(["mkvmerge"]);
        jest.spyOn(runner, "run").mockRejectedValue(failure);

        await expect(new MkvmergeMuxer(runner).mux(request)).rejects.toBe(failure);
    });

    test("continues to reject ffmpeg exit code 1", async () => {
        const runner = new RecordingRunner(["ffmpeg"]);
        const failure = new ExecutableExitError("ffmpeg", 1, "Invalid input");
        jest.spyOn(runner, "run").mockRejectedValue(failure);

        await expect(new FFmpegMuxer(runner).mux(request)).rejects.toBe(failure);
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
                    "english audio track.ts",
                    "-i",
                    "japanese audio track.ts",
                    "-map",
                    "0",
                    "-map",
                    "1",
                    "-map",
                    "2",
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
