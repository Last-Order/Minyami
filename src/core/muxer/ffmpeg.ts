import { MP4_CONTAINER } from "../media_container";
import { ExecutableRunner, SystemExecutableRunner } from "./executable_runner";
import { Muxer, MuxRequest } from "./types";

export class FFmpegMuxer implements Muxer {
    readonly name = "ffmpeg";
    readonly outputContainer = MP4_CONTAINER;

    constructor(private readonly runner: ExecutableRunner = new SystemExecutableRunner()) {}

    isAvailable(): Promise<boolean> {
        return this.runner.isAvailable("ffmpeg", ["-version"]);
    }

    mux(request: MuxRequest): Promise<void> {
        const inputs = request.inputs.flatMap((input) => ["-i", input.inputPath]);
        const mappings = request.inputs.flatMap((_input, index) => ["-map", `${index}`]);
        return this.runner.run("ffmpeg", [
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-n",
            ...inputs,
            ...mappings,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            request.outputPath,
        ]);
    }
}
