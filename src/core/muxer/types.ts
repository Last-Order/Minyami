import { MediaContainer } from "../media_container";
import { MediaTrack } from "../source/stream_selection";

export interface MuxInput {
    readonly trackId: string;
    readonly mediaTrack: MediaTrack;
    readonly inputPath: string;
}

export interface MuxRequest {
    readonly inputs: readonly MuxInput[];
    /** The muxer must publish its completed container at this exact path. */
    readonly outputPath: string;
}

/** A container implementation independent from download protocols and lifecycle state. */
export interface Muxer {
    readonly name: string;
    readonly outputContainer: MediaContainer;
    isAvailable(): Promise<boolean>;
    mux(request: MuxRequest): Promise<void>;
}
