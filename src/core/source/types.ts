import { AxiosRequestConfig, AxiosResponse } from "axios";
import { MediaContainer } from "../media_container";
import { MediaTrack } from "./stream_selection";

export type DownloadItemKind = "init" | "media";

export type DownloadTrackId = string;

export interface DownloadByteRange {
    /** Zero-based offset from the beginning of the upstream resource. */
    readonly offset: number;
    /** Number of bytes to download. */
    readonly length: number;
}

export interface Aes128CbcEncryption {
    readonly scheme: "aes-128-cbc";
    /** Stable key-store identity. HLS sources use the absolute key URL. */
    readonly keyId: string;
    /** Fully resolved hexadecimal IV; executors do not derive protocol defaults. */
    readonly iv: string;
}

export interface MpegTsSampleAesEncryption {
    readonly scheme: "mpeg-ts-sample-aes";
    /** Stable key-store identity. FairPlay HLS sources normally use the opaque skd URI. */
    readonly keyId: string;
    /** Explicit hexadecimal IV from the playlist; this implementation never derives a FairPlay IV. */
    readonly iv: string;
}

export interface IsoBmffSampleAesKey {
    /** Decimal track id or canonical 128-bit hexadecimal KID accepted by mp4decrypt. */
    readonly selector: string;
    readonly keyId: string;
}

export type IsoBmffSampleAesEncryption =
    | {
          readonly scheme: "iso-bmff-sample-aes";
          readonly operation: "initialization";
          readonly keys: readonly IsoBmffSampleAesKey[];
      }
    | {
          readonly scheme: "iso-bmff-sample-aes";
          readonly operation: "fragment";
          readonly keys: readonly IsoBmffSampleAesKey[];
          /** Encrypted initialization metadata passed to mp4decrypt as --fragments-info. */
          readonly fragmentsInfoBase64: string;
      };

export type DownloadEncryption = Aes128CbcEncryption | MpegTsSampleAesEncryption | IsoBmffSampleAesEncryption;

/** Opaque output-prefix identity. Concentrators compare it but never interpret its protocol or format. */
export interface DownloadOutputPrefix {
    readonly slot: string;
    readonly identity: string;
}

/**
 * Protocol-neutral ordered-output semantics published by a source.
 * A replayable prefix replaces the cached value in its slot. Required prefixes
 * are prepended only when a later item begins a fresh output run.
 */
export interface DownloadOutputLayout {
    readonly replayablePrefix?: DownloadOutputPrefix;
    readonly requiredPrefixes?: readonly DownloadOutputPrefix[];
    readonly startsNewRun?: boolean;
}

interface BaseDownloadItem {
    readonly url: string;
    readonly byteRange?: DownloadByteRange;
    readonly encryption?: DownloadEncryption;
    readonly output?: DownloadOutputLayout;
}

export interface InitialDownloadItem extends BaseDownloadItem {
    readonly kind: "init";
}

export interface MediaDownloadItem extends BaseDownloadItem {
    readonly kind: "media";
    readonly duration: number;
}

/**
 * An immutable piece of work discovered by a source. Runtime-only state such as
 * retry counters, task ids, and output filenames is added by the downloader.
 */
export type DownloadItem = InitialDownloadItem | MediaDownloadItem;

export interface DownloadItemNamingContext {
    /** Monotonically increasing across every item yielded by the source. */
    readonly taskId: number;
    readonly trackId: DownloadTrackId;
    /** Monotonically increasing only within the item's declared track. */
    readonly trackIndex: number;
}

export type DownloadItemNamer = (item: DownloadItem, context: DownloadItemNamingContext) => string;

export interface SourceBatch {
    /** Every item in a batch belongs to one previously declared track. */
    readonly trackId: DownloadTrackId;
    readonly items: readonly DownloadItem[];
    /** Present when the source knows this track's final number of items. */
    readonly totalItemCount?: number;
}

export interface SourceTrack {
    /** Filesystem-safe execution identity used by batches, temporary paths, and output suffixes. */
    readonly id: DownloadTrackId;
    /** The same logical track descriptor exposed to stream selectors. */
    readonly mediaTrack: MediaTrack;
    /** Actual upstream location for this track, which may differ from the source entry point. */
    readonly sourcePath: string;
    readonly itemNamer?: DownloadItemNamer;
    readonly itemTimeout?: number;
}

export type SourceMetadata =
    | {
          /** A source may end preparation without treating a user cancellation as a failure. */
          readonly cancelled: true;
      }
    | {
          readonly cancelled?: false;
          /** Container used when concentrated tracks are retained without cross-track muxing. */
          readonly container: MediaContainer;
          /** Track order is stable and also determines output/snapshot order. */
          readonly tracks: readonly SourceTrack[];
      };

export interface DownloadSourceHttpClient {
    get<T = any>(url: string, options?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
    request<T = any>(url: string, options?: AxiosRequestConfig): Promise<AxiosResponse<T>>;
}

export interface DownloadSourceKeyStore {
    set(id: string, key: string): void;
    get(id: string): string | undefined;
    has(id: string): boolean;
    setMany(keys: Readonly<Record<string, string>>): void;
}

export interface DownloadSourceContext {
    /** Source requests use a retrying facade; protocols never own execution retry counters. */
    readonly http: DownloadSourceHttpClient;
    readonly keys: DownloadSourceKeyStore;
}

/**
 * Produces batches of download items. Snapshot sources normally yield once;
 * continuous sources may yield any number of batches before ending.
 */
export interface DownloadSource {
    readonly sourcePath: string;
    /** Controls progress semantics only; source exhaustion is still defined by the iterator. */
    readonly continuous: boolean;

    /** Performs source-specific setup and must finish before any item is yielded. */
    prepare(context: DownloadSourceContext, signal: AbortSignal): Promise<SourceMetadata>;
    /** Ends naturally when no more items can arrive, or promptly after graceful cancellation. */
    discover(context: DownloadSourceContext, signal: AbortSignal): AsyncIterable<SourceBatch>;
}
