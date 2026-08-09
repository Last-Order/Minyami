import { MATROSKA_CONTAINER } from "../media_container";
import { ExecutableRunner, SystemExecutableRunner } from "./executable_runner";
import { Muxer, MuxRequest } from "./types";

export class MkvmergeMuxer implements Muxer {
    readonly name = "mkvmerge";
    readonly outputContainer = MATROSKA_CONTAINER;

    constructor(private readonly runner: ExecutableRunner = new SystemExecutableRunner()) {}

    isAvailable(): Promise<boolean> {
        return this.runner.isAvailable("mkvmerge", ["--version"]);
    }

    mux(request: MuxRequest): Promise<void> {
        return this.runner.run("mkvmerge", [
            "--output",
            request.outputPath,
            ...request.inputs.map((input) => input.inputPath),
        ]);
    }
}
