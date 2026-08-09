// HLS protocol models stay inside the source boundary so shared download code remains protocol-neutral.
export class HLSParseError extends Error {}

export interface HLSParseOptions {
    readonly content: string;
    readonly playlistUrl?: string;
}

export enum HLSPlaylistKind {
    Master = "master",
    Media = "media",
}

export enum HLSSegmentKind {
    Initialization = "init",
    Media = "media",
}

export interface HLSVariant {
    readonly url: string;
    readonly bandwidth: number;
    readonly codecs?: string;
    readonly frameRate?: number;
    readonly resolution?: { readonly width: number; readonly height: number };
}

export interface HLSMasterPlaylist {
    readonly kind: HLSPlaylistKind.Master;
    readonly variants: readonly HLSVariant[];
}

export interface HLSMediaEncryption {
    readonly method: "AES-128";
    readonly keyUrl: string;
    readonly iv?: string;
}

export interface HLSInitializationEncryption extends HLSMediaEncryption {
    readonly iv: string;
}

export interface HLSInitializationSegment {
    readonly kind: HLSSegmentKind.Initialization;
    readonly url: string;
    readonly encryption?: HLSInitializationEncryption;
}

export interface HLSMediaSegment {
    readonly kind: HLSSegmentKind.Media;
    readonly url: string;
    readonly duration: number;
    readonly sequenceId: number;
    readonly encryption?: HLSMediaEncryption;
}

export type HLSSegment = HLSInitializationSegment | HLSMediaSegment;

export interface HLSMediaPlaylist {
    readonly kind: HLSPlaylistKind.Media;
    readonly segments: readonly HLSSegment[];
    readonly encryptionKeyUrls: readonly string[];
    readonly hasEndList: boolean;
    readonly totalDuration: number;
    readonly averageSegmentDuration: number;
}

export type HLSPlaylist = HLSMasterPlaylist | HLSMediaPlaylist;
