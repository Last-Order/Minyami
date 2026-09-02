export type MediaTrackType = "video" | "audio";

export interface BaseMediaTrack {
    /** Opaque identity unique inside one stream catalog. */
    readonly id: string;
    readonly type: MediaTrackType;
    readonly name?: string;
    readonly bandwidth?: number;
    readonly codecs?: readonly string[];
}

export interface VideoTrack extends BaseMediaTrack {
    readonly type: "video";
    readonly width?: number;
    readonly height?: number;
    readonly frameRate?: number;
}

export interface AudioTrack extends BaseMediaTrack {
    readonly type: "audio";
    readonly language?: string;
    readonly role?: string;
    readonly channels?: number;
    readonly isDefault?: boolean;
}

export type MediaTrack = VideoTrack | AudioTrack;

export type TrackSelection = readonly [MediaTrack, ...MediaTrack[]];

/** A protocol-derived set of tracks that may be selected together. */
export interface StreamOption {
    readonly id: string;
    readonly tracks: TrackSelection;
    /** Declared or estimated aggregate bandwidth used for default ordering. */
    readonly bandwidth?: number;
}

export interface StreamCatalog {
    /** Canonical objects accepted from a selector. */
    readonly tracks: readonly MediaTrack[];
    /** Compatibility boundaries derived from the source manifest. */
    readonly options: readonly StreamOption[];
}

export type StreamSelector = (
    catalog: StreamCatalog,
) => TrackSelection | undefined | Promise<TrackSelection | undefined>;

/** Freezes the canonical descriptor in place so its identity survives every layer unchanged. */
/** Prevents selectors from mutating the canonical identities and compatibility graph they inspect. */
export function freezeStreamCatalog(catalog: StreamCatalog): StreamCatalog {
    for (const track of catalog.tracks) {
        Object.freeze(track);
    }
    for (const option of catalog.options) {
        Object.freeze(option.tracks);
        Object.freeze(option);
    }
    Object.freeze(catalog.tracks);
    Object.freeze(catalog.options);
    return Object.freeze(catalog);
}

/**
 * Validates untrusted API selector output without exposing protocol-specific locators.
 * A selection may be a subset of an option, but it may not cross option boundaries.
 */
export function validateTrackSelection(catalog: StreamCatalog, selection: readonly MediaTrack[]): TrackSelection {
    if (selection.length === 0) {
        throw new Error("Stream selector returned an empty track selection.");
    }

    const selected = new Set<MediaTrack>();
    for (const track of selection) {
        if (!catalog.tracks.includes(track)) {
            throw new Error("Stream selector returned a track that was not offered by the source.");
        }
        if (selected.has(track)) {
            throw new Error(`Stream selector returned duplicate track: ${track.id}`);
        }
        selected.add(track);
    }

    const compatible = catalog.options.some((option) => selection.every((track) => option.tracks.includes(track)));
    if (!compatible) {
        throw new Error("Stream selector returned tracks that do not belong to one compatible stream option.");
    }

    return selection as TrackSelection;
}
