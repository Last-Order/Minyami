import { FFmpegMuxer } from "./ffmpeg";
import { MkvmergeMuxer } from "./mkvmerge";
import { Muxer } from "./types";

/** Candidate order is policy: mkvmerge wins whenever both tools are on PATH. */
export function createDefaultMuxers(): readonly Muxer[] {
    return [new MkvmergeMuxer(), new FFmpegMuxer()];
}

export async function selectAvailableMuxer(candidates: readonly Muxer[]): Promise<Muxer | undefined> {
    for (const muxer of candidates) {
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
