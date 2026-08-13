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

export interface HLSByteRange {
    readonly offset: number;
    readonly length: number;
}

export interface HLSVariant {
    readonly url: string;
    readonly bandwidth: number;
    readonly codecs?: string;
    readonly frameRate?: number;
    readonly resolution?: { readonly width: number; readonly height: number };
    readonly audioGroupId?: string;
}

export interface HLSAudioRendition {
    readonly groupId: string;
    readonly name: string;
    readonly url?: string;
    readonly language?: string;
    readonly characteristics?: string;
    readonly channels?: number;
    readonly isDefault: boolean;
    readonly autoSelect: boolean;
}

export interface HLSMasterPlaylist {
    readonly kind: HLSPlaylistKind.Master;
    readonly variants: readonly HLSVariant[];
    readonly audioRenditions: readonly HLSAudioRendition[];
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
    readonly byteRange?: HLSByteRange;
    readonly encryption?: HLSInitializationEncryption;
}

export interface HLSMediaSegment {
    readonly kind: HLSSegmentKind.Media;
    readonly url: string;
    readonly duration: number;
    readonly sequenceId: number;
    readonly byteRange?: HLSByteRange;
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
