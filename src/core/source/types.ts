import { ChunkNamer } from "../download/chunk_naming";
import { DownloadHttpClient } from "../download/http_client";
import { KeyStore } from "../download/key_store";
import { M3U8Chunk } from "../m3u8";

/**
 * An immutable piece of work discovered by a source. Runtime-only state such as
 * retry counters, task ids, and output filenames is added by the downloader.
 */
export interface DownloadItem {
    chunk: M3U8Chunk;
    /** Absolute lookup key; executors must not depend on mutable source/playlist state. */
    encryptionKeyUrl?: string;
}

export interface SourceBatch {
    items: DownloadItem[];
    /** Present when the source knows the final number of items. */
    totalItemCount?: number;
}

export interface SourceMetadata {
    sourcePath: string;
    chunkNamer?: ChunkNamer;
    chunkTimeout?: number;
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
