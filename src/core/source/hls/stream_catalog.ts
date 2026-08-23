import {
    AudioTrack,
    freezeStreamCatalog,
    MediaTrack,
    StreamCatalog,
    StreamOption,
    VideoTrack,
} from "../stream_selection";
import { DownloadTrackId } from "../types";
import { HLSAudioRendition, HLSMasterPlaylist, HLSParseError, HLSVariant } from "./playlist/models";

export interface HLSMediaTrackPlan {
    readonly sourceTrackId: DownloadTrackId;
    readonly sourcePath: string;
}

export interface HLSStreamCatalogPlan {
    readonly catalog: StreamCatalog;
    readonly mediaTracks: ReadonlyMap<MediaTrack, HLSMediaTrackPlan>;
}

/** Normalizes HLS linkage while retaining playlist URLs only in the private plan. */
export function createHLSStreamCatalogPlan(master: HLSMasterPlaylist): HLSStreamCatalogPlan {
    const tracks: MediaTrack[] = [];
    const options: StreamOption[] = [];
    const mediaTracks = new Map<MediaTrack, HLSMediaTrackPlan>();
    const externalAudioTracks = new Map<HLSAudioRendition, AudioTrack>();
    const groups = groupAudioRenditions(master.audioRenditions);

    master.variants.forEach((variant, variantIndex) => {
        const primary = createPrimaryTrack(variant, variantIndex);
        addTrack(primary, variant.url);

        const optionTracks: MediaTrack[] = [primary];
        if (variant.audioGroupId) {
            const renditions = groups.get(variant.audioGroupId);
            if (!renditions?.length) {
                throw new HLSParseError(`Missing audio renditions for group ${variant.audioGroupId}.`);
            }
            for (const rendition of renditions) {
                // A URI-less rendition is already multiplexed into the primary resource,
                // so it must not create a duplicate physical download track. The current
                // design also assumes that a primary video carrying embedded audio will
                // not be paired with a separately downloadable audio track. If such
                // manifests need support later, model physical resource content and mux
                // policy explicitly instead of treating the embedded audio as another cursor.
                if (!rendition.url) {
                    continue;
                }
                let audioTrack = externalAudioTracks.get(rendition);
                if (!audioTrack) {
                    audioTrack = createAudioTrack(rendition, master.audioRenditions.indexOf(rendition));
                    externalAudioTracks.set(rendition, audioTrack);
                    addTrack(audioTrack, rendition.url);
                }
                optionTracks.push(audioTrack);
            }
        }

        options.push({
            id: `option-${variantIndex + 1}`,
            tracks: optionTracks as [MediaTrack, ...MediaTrack[]],
            bandwidth: variant.bandwidth,
        });
    });

    return { catalog: freezeStreamCatalog({ tracks, options }), mediaTracks };

    function addTrack(track: MediaTrack, sourcePath: string): void {
        if (!tracks.includes(track)) {
            tracks.push(track);
            // HLS-generated logical ids are already safe, but the private plan owns
            // the execution identity so future protocols need not reuse manifest ids.
            mediaTracks.set(track, { sourceTrackId: track.id, sourcePath });
        }
    }
}

function groupAudioRenditions(
    renditions: readonly HLSAudioRendition[]
): ReadonlyMap<string, readonly HLSAudioRendition[]> {
    const groups = new Map<string, HLSAudioRendition[]>();
    for (const rendition of renditions) {
        const group = groups.get(rendition.groupId) ?? [];
        group.push(rendition);
        groups.set(rendition.groupId, group);
    }
    return groups;
}

function createPrimaryTrack(variant: HLSVariant, index: number): VideoTrack | AudioTrack {
    const codecs = variant.codecs?.split(",").map((codec) => codec.trim());
    if (isAudioOnlyVariant(variant, codecs)) {
        return {
            id: `audio-primary-${index + 1}`,
            type: "audio",
            bandwidth: variant.bandwidth,
            ...(codecs?.length ? { codecs } : {}),
        };
    }
    return {
        id: `video-${index + 1}`,
        type: "video",
        bandwidth: variant.bandwidth,
        ...(codecs?.length ? { codecs } : {}),
        ...(variant.resolution ? { width: variant.resolution.width, height: variant.resolution.height } : {}),
        ...(variant.frameRate !== undefined ? { frameRate: variant.frameRate } : {}),
    };
}

function createAudioTrack(rendition: HLSAudioRendition, index: number): AudioTrack {
    return {
        id: `audio-${index + 1}`,
        type: "audio",
        name: rendition.name,
        ...(rendition.language ? { language: rendition.language } : {}),
        ...(rendition.characteristics ? { role: rendition.characteristics } : {}),
        ...(rendition.channels !== undefined ? { channels: rendition.channels } : {}),
        isDefault: rendition.isDefault,
    };
}

function isAudioOnlyVariant(variant: HLSVariant, codecs?: readonly string[]): boolean {
    if (variant.resolution || !codecs?.length) {
        return false;
    }
    return codecs.every(isAudioCodec);
}

function isAudioCodec(codec: string): boolean {
    const prefix = codec.toLowerCase().split(".")[0];
    return ["mp4a", "ac-3", "ec-3", "opus", "vorbis", "flac", "alac"].includes(prefix);
}
