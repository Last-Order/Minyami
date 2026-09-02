import prompts from "prompts";
import logger from "@/utils/log";
import { AudioTrack, MediaTrack, StreamCatalog, StreamOption, TrackSelection, VideoTrack } from "./stream_selection";

interface StreamOptionChoice {
    readonly title: string;
    readonly value: StreamOption;
}

interface VideoChoiceValue {
    readonly option: StreamOption;
    readonly track: VideoTrack;
}

interface VideoChoice {
    readonly title: string;
    readonly value: VideoChoiceValue;
}

interface AudioChoice {
    readonly title: string;
    readonly value: AudioTrack;
    readonly selected: boolean;
}

const TRACK_DETAIL_SEPARATOR = " · ";

export function selectDefaultStream(catalog: StreamCatalog): TrackSelection | undefined {
    return createStreamOptionChoices(catalog)[0]?.value.tracks;
}

/** Selects tracks in protocol-compatible stages while keeping API selection output track-based. */
export async function selectStreamInteractively(catalog: StreamCatalog): Promise<TrackSelection | undefined> {
    const defaultSelection = selectDefaultStream(catalog);
    if (!defaultSelection) {
        return undefined;
    }

    const videoChoices = createVideoChoices(catalog);
    if (videoChoices.length === 0 && catalog.options.length === 1) {
        return defaultSelection;
    }
    if (videoChoices.length === 1 && createAudioChoices(videoChoices[0].value.option).length === 0) {
        return [videoChoices[0].value.track];
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        logger.warning("Interactive stream selection is unavailable. Selecting the highest-bandwidth option.");
        return defaultSelection;
    }

    if (videoChoices.length === 0) {
        return selectAudioOnlyOption(catalog);
    }

    const selectedVideo = await selectVideo(videoChoices);
    if (!selectedVideo) {
        return undefined;
    }

    const audioChoices = createAudioChoices(selectedVideo.option);
    if (audioChoices.length === 0) {
        return [selectedVideo.track];
    }

    const response = await prompts({
        type: "multiselect",
        name: "audio",
        message: "Select audio tracks",
        choices: audioChoices,
    });
    const selectedAudios = response.audio as readonly AudioTrack[] | undefined;
    if (selectedAudios === undefined) {
        return undefined;
    }

    // The second prompt is derived from the selected option so it cannot cross a manifest compatibility boundary.
    const selectedAudioSet = new Set(selectedAudios);
    return [
        selectedVideo.track,
        ...audioChoices.filter((choice) => selectedAudioSet.has(choice.value)).map((choice) => choice.value),
    ];
}

async function selectVideo(choices: readonly VideoChoice[]): Promise<VideoChoiceValue | undefined> {
    if (choices.length === 1) {
        return choices[0].value;
    }

    const response = await prompts({
        type: "select",
        name: "video",
        message: "Select a video track",
        choices: [...choices],
        initial: 0,
    });
    return response.video as VideoChoiceValue | undefined;
}

async function selectAudioOnlyOption(catalog: StreamCatalog): Promise<TrackSelection | undefined> {
    const choices = createStreamOptionChoices(catalog);
    if (choices.length === 1) {
        return choices[0].value.tracks;
    }

    const response = await prompts({
        type: "select",
        name: "option",
        message: "Select an audio track",
        choices,
        initial: 0,
    });
    return (response.option as StreamOption | undefined)?.tracks;
}

function createVideoChoices(catalog: StreamCatalog): VideoChoice[] {
    return catalog.options
        .flatMap((option) =>
            option.tracks
                .filter((track): track is VideoTrack => track.type === "video")
                .map((track) => ({ option, track })),
        )
        .sort((a, b) => effectiveBandwidth(b.option) - effectiveBandwidth(a.option))
        .map((value) => ({
            title: formatVideoChoice(value),
            value,
        }));
}

function createAudioChoices(option: StreamOption): AudioChoice[] {
    const tracks = option.tracks.filter((track): track is AudioTrack => track.type === "audio");
    const declaredDefaultIndex = tracks.findIndex((track) => track.isDefault);
    const selectedIndex = declaredDefaultIndex >= 0 ? declaredDefaultIndex : 0;
    return tracks.map((track, index) => ({
        title: formatAudioTrack(track),
        value: track,
        // Keep pressing Enter compatible with the old single-select default while allowing users to toggle more tracks.
        selected: index === selectedIndex,
    }));
}

function formatVideoChoice(choice: VideoChoiceValue): string {
    const details = [`video: ${formatVideoTrack(choice.track)}`];
    if (choice.option.bandwidth !== undefined) {
        details.push(formatBandwidth(choice.option.bandwidth));
    }
    return details.join(TRACK_DETAIL_SEPARATOR);
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
            : track.name || track.id,
    );
    if (track.frameRate !== undefined) {
        details.push(`${track.frameRate} fps`);
    }
    if (track.codecs?.length) {
        details.push(track.codecs.join(","));
    }
    return details.join(TRACK_DETAIL_SEPARATOR);
}

function formatAudioTrack(track: AudioTrack): string {
    const label = track.name || track.language || track.id;
    const details = [track.language && track.language !== label ? `${label} (${track.language})` : label];
    if (track.channels !== undefined) {
        details.push(`${track.channels} ch`);
    }
    if (track.codecs?.length) {
        details.push(track.codecs.join(","));
    }
    if (track.bandwidth !== undefined) {
        details.push(`${(track.bandwidth / 1_000).toFixed(0)} kbps`);
    }
    return details.join(TRACK_DETAIL_SEPARATOR);
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
