import { MATROSKA_CONTAINER, MediaContainer, MP4_CONTAINER } from "../media_container";
import { ExecutableRunner, SystemExecutableRunner } from "./executable_runner";
import { Muxer, MuxRequest } from "./types";

export class FFmpegMuxer implements Muxer {
    readonly name = "ffmpeg";
    readonly outputContainer: MediaContainer;
    readonly preservesTimestamps: boolean;

    constructor(
        private readonly runner: ExecutableRunner = new SystemExecutableRunner(),
        format: "mp4" | "mkv" = "mp4",
    ) {
        this.outputContainer = format === "mkv" ? MATROSKA_CONTAINER : MP4_CONTAINER;
        this.preservesTimestamps = format === "mkv";
    }

    isAvailable(): Promise<boolean> {
        return this.runner.isAvailable("ffmpeg", ["-version"]);
    }

    mux(request: MuxRequest): Promise<void> {
        const inputs = request.inputs.flatMap((input) => ["-i", input.inputPath]);
        const matroska = this.outputContainer === MATROSKA_CONTAINER;
        const mappings = request.inputs.flatMap(({ mediaTrack }, index) => {
            if (!matroska) {
                return ["-map", `${index}`];
            }
            // A selected primary resource can carry both audio and video, plus data streams such as timed ID3.
            return mediaTrack.type === "subtitle"
                ? ["-map", `${index}:s:0`]
                : ["-map", `${index}:v?`, "-map", `${index}:a?`];
        });
        const subtitleOptions = request.inputs
            .map(({ mediaTrack }) => mediaTrack)
            .filter((track) => track.type === "subtitle")
            .flatMap((track, index) => {
                const metadata = `-metadata:s:s:${index}`;
                const disposition = [track.isDefault ? "default" : "", track.isForced ? "forced" : ""]
                    .filter(Boolean)
                    .join("+");
                return [
                    ...(track.name ? [metadata, `title=${track.name}`] : []),
                    ...(track.language ? [metadata, `language=${track.language}`] : []),
                    `-disposition:s:${index}`,
                    disposition || "0",
                ];
            });
        return this.runner.run("ffmpeg", [
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-n",
            ...(this.preservesTimestamps ? ["-copyts"] : []),
            ...inputs,
            ...mappings,
            "-c",
            "copy",
            ...(matroska
                ? [...subtitleOptions, "-avoid_negative_ts", "disabled", "-f", "matroska"]
                : ["-movflags", "+faststart"]),
            request.outputPath,
        ]);
    }
}
