import { DownloadHttpClient } from "../download/http_client";
import { KeyStore } from "../download/key_store";

export type DownloadItemKind = "init" | "media";

export interface Aes128CbcEncryption {
    readonly scheme: "aes-128-cbc";
    /** Stable key-store identity. HLS sources use the absolute key URL. */
    readonly keyId: string;
    /** Fully resolved hexadecimal IV; executors do not derive protocol defaults. */
    readonly iv: string;
}

export type DownloadEncryption = Aes128CbcEncryption;

interface BaseDownloadItem {
    readonly url: string;
    readonly encryption?: DownloadEncryption;
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

export type DownloadItemNamer = (item: DownloadItem, id: number) => string;

export interface SourceBatch {
    readonly items: readonly DownloadItem[];
    /** Present when the source knows the final number of items. */
    totalItemCount?: number;
}

export interface SourceMetadata {
    sourcePath: string;
    itemNamer?: DownloadItemNamer;
    itemTimeout?: number;
    /** A source may end preparation without treating a user cancellation as a failure. */
    cancelled?: boolean;
}

export interface DownloadSourceContext {
    /** Shared dependencies let discovery and execution use one isolated HTTP/key session. */
    readonly http: DownloadHttpClient;
    readonly keys: KeyStore;
    readonly retries: number;
    readonly explicitKey?: string;
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
