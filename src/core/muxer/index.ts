import { FFmpegMuxer } from "./ffmpeg";
import { MkvmergeMuxer } from "./mkvmerge";
import { Muxer } from "./types";

/** For unconstrained output, prefer mkvmerge for MKV, then FFmpeg for MP4. */
export function createDefaultMuxers(): readonly Muxer[] {
    return [new MkvmergeMuxer(), new FFmpegMuxer(), new FFmpegMuxer(undefined, "mkv")];
}

export async function selectAvailableMuxer(
    candidates: readonly Muxer[],
    preserveTimestamps = false,
): Promise<Muxer | undefined> {
    for (const muxer of candidates) {
        if (preserveTimestamps && !muxer.preservesTimestamps) {
            continue;
        }
        try {
            if (await muxer.isAvailable()) {
                return muxer;
            }
        } catch {
            // A broken availability probe is equivalent to an unavailable optional tool.
        }
    }
    return undefined;
}

export { FFmpegMuxer } from "./ffmpeg";
export { MkvmergeMuxer } from "./mkvmerge";
export type { ExecutableRunner } from "./executable_runner";
export type { Muxer, MuxInput, MuxRequest } from "./types";
