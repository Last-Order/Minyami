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

export enum HLSKeyReferenceKind {
    Http = "http",
    Inline = "inline",
    External = "external",
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

export interface HLSHttpKeyReference {
    readonly kind: HLSKeyReferenceKind.Http;
    /** Stable identity used by the shared key store. */
    readonly id: string;
    /** Fetchable HTTP(S) location for the raw key bytes. */
    readonly url: string;
}

export interface HLSExternalKeyReference {
    readonly kind: HLSKeyReferenceKind.External;
    /** Stable identity used by the shared key store. */
    readonly id: string;
    /** Opaque source-provided URI; it is never treated as a download URL. */
    readonly uri: string;
}

export interface HLSInlineKeyReference {
    readonly kind: HLSKeyReferenceKind.Inline;
    /** Stable identity used by the shared key store. */
    readonly id: string;
    /** Self-contained data URI resolved locally without external key acquisition. */
    readonly uri: string;
}

export type HLSKeyReference = HLSHttpKeyReference | HLSInlineKeyReference | HLSExternalKeyReference;

export interface HLSAes128Encryption {
    readonly method: "AES-128";
    readonly key: HLSKeyReference;
    readonly iv?: string;
}

export interface HLSSampleAesEncryption {
    readonly method: "SAMPLE-AES";
    readonly key: HLSKeyReference;
    readonly iv?: string;
    /** Opaque key-acquisition metadata; explicit raw keys keep DRM handling outside Minyami. */
    readonly keyFormat: string;
}

export type HLSMediaEncryption = HLSAes128Encryption | HLSSampleAesEncryption;

export interface HLSInitializationSegment {
    readonly kind: HLSSegmentKind.Initialization;
    /** Stable within one media playlist and shared by every media segment that uses this map. */
    readonly initializationId: string;
    readonly url: string;
    readonly byteRange?: HLSByteRange;
    readonly encryption?: HLSMediaEncryption;
}

export interface HLSMediaSegment {
    readonly kind: HLSSegmentKind.Media;
    readonly url: string;
    readonly duration: number;
    readonly sequenceId: number;
    readonly initializationId?: string;
    readonly byteRange?: HLSByteRange;
    readonly encryption?: HLSMediaEncryption;
}

export type HLSSegment = HLSInitializationSegment | HLSMediaSegment;

export interface HLSMediaPlaylist {
    readonly kind: HLSPlaylistKind.Media;
    readonly segments: readonly HLSSegment[];
    readonly keys: readonly HLSKeyReference[];
    readonly hasEndList: boolean;
    readonly totalDuration: number;
    readonly averageSegmentDuration: number;
}

export type HLSPlaylist = HLSMasterPlaylist | HLSMediaPlaylist;
