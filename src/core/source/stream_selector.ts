import prompts from "prompts";
import logger from "../../utils/log";
import { AudioTrack, MediaTrack, StreamCatalog, StreamOption, TrackSelection, VideoTrack } from "./stream_selection";

interface StreamOptionChoice {
    readonly title: string;
    readonly value: StreamOption;
}

export function selectDefaultStream(catalog: StreamCatalog): TrackSelection | undefined {
    return createStreamOptionChoices(catalog)[0]?.value.tracks;
}

/** Selects one protocol-compatible option while keeping API selection output track-based. */
export async function selectStreamInteractively(catalog: StreamCatalog): Promise<TrackSelection | undefined> {
    const choices = createStreamOptionChoices(catalog);
    if (choices.length === 0) {
        return undefined;
    }
    if (choices.length === 1) {
        return choices[0].value.tracks;
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        logger.warning("Interactive stream selection is unavailable. Selecting the highest-bandwidth option.");
        return choices[0].value.tracks;
    }

    const response = await prompts({
        type: "select",
        name: "option",
        message: "Select a stream option",
        choices,
        initial: 0,
    });
    return (response.option as StreamOption | undefined)?.tracks;
}

function createStreamOptionChoices(catalog: StreamCatalog): StreamOptionChoice[] {
    return [...catalog.options]
        .sort((a, b) => effectiveBandwidth(b) - effectiveBandwidth(a))
        .map((option) => ({
            title: formatStreamOption(option),
            value: option,
        }));
}

function formatStreamOption(option: StreamOption): string {
    const videos = option.tracks.filter((track): track is VideoTrack => track.type === "video");
    const audios = option.tracks.filter((track): track is AudioTrack => track.type === "audio");
    const details: string[] = [];

    if (videos.length > 0) {
        details.push(`video: ${videos.map(formatVideoTrack).join(", ")}`);
    }
    if (audios.length > 0) {
        details.push(`audio: ${audios.map(formatAudioTrack).join(", ")}`);
    }
    if (option.bandwidth !== undefined) {
        details.push(formatBandwidth(option.bandwidth));
    }
    return details.join(" | ") || "unnamed stream option";
}

function formatVideoTrack(track: VideoTrack): string {
    const details: string[] = [];
    details.push(
        track.width !== undefined && track.height !== undefined
            ? `${track.width}x${track.height}`
            : track.name || track.id
    );
    if (track.frameRate !== undefined) {
        details.push(`${track.frameRate} fps`);
    }
    if (track.codecs?.length) {
        details.push(track.codecs.join(","));
    }
    return details.join(" ");
}

function formatAudioTrack(track: AudioTrack): string {
    const label = track.name || track.language || track.id;
    return track.language && track.language !== label ? `${label} (${track.language})` : label;
}

function effectiveBandwidth(option: StreamOption): number {
    if (option.bandwidth !== undefined) {
        return option.bandwidth;
    }
    return option.tracks.reduce((total, track: MediaTrack) => total + (track.bandwidth ?? 0), 0);
}

function formatBandwidth(bandwidth: number): string {
    return `${(bandwidth / 1_000_000).toFixed(2)} Mbps`;
}
