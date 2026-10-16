import logger from "@/utils/log";
import { MATROSKA_CONTAINER } from "../media_container";
import { ExecutableExitError, ExecutableRunner, SystemExecutableRunner } from "./executable_runner";
import { Muxer, MuxRequest } from "./types";

export class MkvmergeMuxer implements Muxer {
    readonly name = "mkvmerge";
    readonly outputContainer = MATROSKA_CONTAINER;

    constructor(private readonly runner: ExecutableRunner = new SystemExecutableRunner()) {}

    isAvailable(): Promise<boolean> {
        return this.runner.isAvailable("mkvmerge", ["--version"]);
    }

    async mux(request: MuxRequest): Promise<void> {
        try {
            await this.runner.run("mkvmerge", [
                "--quiet",
                "--output",
                request.outputPath,
                ...request.inputs.map((input) => input.inputPath),
            ]);
        } catch (error) {
            // mkvmerge exit code 1 means muxing continued with warnings; code 2 and process failures remain fatal.
            if (!(error instanceof ExecutableExitError) || error.exitCode !== 1) {
                throw error;
            }
            logger.warning(`mkvmerge completed with warnings.${error.diagnostic ? `\n${error.diagnostic}` : ""}`);
        }
    }
}
