import logger from "../../utils/log";
import { buildFullUrl } from "../../utils/common";
import { isInitialChunk, isNormalChunk, MasterPlaylist, M3U8Chunk, Playlist } from "../m3u8";
import { ParserMode, ParserResult } from "../parsers/types";
import { PlaylistLoader } from "../download/playlist_loader";
import { prepareSite } from "../download/site_adapter";
import { DownloadItem, DownloadSource, DownloadSourceContext, SourceBatch, SourceMetadata } from "./types";

export type HLSSourceMode = "snapshot" | "follow";

export interface HLSSourceOptions {
    mode: HLSSourceMode;
    slice?: {
        start: number;
        end: number;
    };
}

/**
 * HLS-specific discovery. Snapshot and follow modes share parsing/key logic;
 * only the number and timing of yielded batches differ.
 */
export class HLSSource implements DownloadSource {
    readonly continuous: boolean;
    sourcePath: string;

    private readonly initialChunkUrls = new Set<string>();
    private readonly sequenceIds = new Set<number>();
    private loader?: PlaylistLoader;
    private playlist?: Playlist;
    private sitePlan: ParserResult = {};
    private timeout = 60000;
    private prepared = false;
    private discoveredItemCount = 0;

    constructor(sourcePath: string, private readonly options: HLSSourceOptions) {
        this.sourcePath = sourcePath;
        this.continuous = options.mode === "follow";
    }

    async prepare(context: DownloadSourceContext, signal: AbortSignal): Promise<SourceMetadata> {
        if (this.prepared) {
            throw new Error("This HLS source has already been prepared.");
        }
        if (!this.sourcePath) {
            throw new Error("Missing M3U8 path.");
        }
        throwIfAborted(signal);
        this.loader = new PlaylistLoader(context.http);
        this.playlist = await this.loadMediaPlaylist(this.sourcePath, context);
        if (this.continuous) {
            this.updateFollowTimeouts();
        }

        this.sitePlan = await prepareSite({
            mode: this.parserMode,
            m3u8Path: this.sourcePath,
            playlist: this.playlist,
            key: context.explicitKey,
            retries: context.retries,
            http: context.http,
        });
        if (this.sitePlan.chunks) {
            this.playlist.chunks = this.sitePlan.chunks;
        }
        if (this.sitePlan.encryptionKeys) {
            context.keys.setMany(this.sitePlan.encryptionKeys);
        }
        // Items may execute as soon as they are yielded, so all known keys must be ready first.
        await this.checkKeys(context);
        this.prepared = true;

        return {
            sourcePath: this.sourcePath,
            chunkNamer: this.sitePlan.chunkNamer,
            chunkTimeout: this.continuous ? this.followChunkTimeout : undefined,
        };
    }

    async *discover(context: DownloadSourceContext, signal: AbortSignal): AsyncIterable<SourceBatch> {
        if (!this.prepared || !this.playlist) {
            throw new Error("HLS source must be prepared before discovering items.");
        }

        if (!this.continuous) {
            // A snapshot source has a final total and deliberately yields exactly once, even when empty.
            const items = sliceItems(this.toItems(this.playlist.chunks), this.options.slice);
            this.discoveredItemCount = items.length;
            yield { items, totalItemCount: items.length };
            return;
        }

        while (!signal.aborted) {
            // Treat each playlist as a snapshot and emit only identities not seen in earlier snapshots.
            const streamEnded = this.playlist.isEnd;
            const chunks = this.takeNewChunks(this.playlist.chunks);
            const items = this.toItems(chunks);
            this.discoveredItemCount += items.length;
            logger.debug(`Get ${items.length} new chunk(s).`);
            if (items.length > 0) {
                yield { items };
            }

            if (streamEnded) {
                logger.info("Stream ended. Waiting for current tasks finished.");
                return;
            }

            logger.debug("Cool down... Wait for next check");
            // Waiting inside the source keeps polling policy out of the shared downloader.
            if (!(await waitForNextCheck(Math.min(5000, this.safeChunkLength * 1000), signal))) {
                return;
            }

            try {
                this.playlist = await this.loadMediaPlaylist(this.sourcePath, context, this.discoveredItemCount);
                await this.checkKeys(context);
            } catch (error) {
                // Initial discovery failures are fatal; after useful work, an unavailable manifest ends a live source.
                if (this.discoveredItemCount === 0) {
                    throw error;
                }
                const status = (error as any)?.response?.status;
                if (status >= 400 && status <= 599) {
                    logger.info("M3U8 file is no longer available. Stop downloading.");
                    return;
                }
                logger.warning("Unable to refresh M3U8 file. Keep the current playlist and retry later.");
            }
        }
    }

    private get parserMode(): ParserMode {
        return this.continuous ? "live" : "archive";
    }

    private get safeChunkLength(): number {
        const chunkLength = this.playlist?.getChunkLength();
        return Number.isFinite(chunkLength) && chunkLength > 0 ? chunkLength : 5;
    }

    private get followChunkTimeout(): number {
        return Math.min(this.safeChunkLength * 1000 * 20, 60000);
    }

    private updateFollowTimeouts(): void {
        this.timeout = Math.min(Math.max(20000, this.playlist.chunks.length * this.safeChunkLength * 1000), 60000);
    }

    private async loadMediaPlaylist(
        sourcePath: string,
        context: DownloadSourceContext,
        initPrimaryKey?: number
    ): Promise<Playlist> {
        const loaded = await this.loader.load(sourcePath, {
            retries: context.retries,
            timeout: this.timeout,
            initPrimaryKey,
        });
        if (!(loaded instanceof MasterPlaylist)) {
            return loaded;
        }

        const bestStream = [...loaded.streams].sort((a, b) => b.bandwidth - a.bandwidth)[0];
        if (!bestStream) {
            throw new Error("Master playlist does not contain any streams.");
        }
        logger.info("Master playlist input detected. Auto selecting best quality streams.");
        logger.debug(`Best stream: ${bestStream.url}; Bandwidth: ${bestStream.bandwidth}`);
        // Follow refreshes must target the selected media playlist, not the master playlist.
        this.sourcePath = bestStream.url;
        const mediaPlaylist = await this.loader.load(bestStream.url, {
            retries: context.retries,
            timeout: this.timeout,
            initPrimaryKey,
        });
        if (mediaPlaylist instanceof MasterPlaylist) {
            throw new Error("Selected HLS stream points to another master playlist.");
        }
        return mediaPlaylist;
    }

    private async checkKeys(context: DownloadSourceContext): Promise<void> {
        if (!this.playlist || this.playlist.encryptKeys.length === 0) {
            return;
        }
        const missingKeys = this.playlist.encryptKeys.filter(
            (key) => !context.keys.has(buildFullUrl(this.playlist.m3u8Url, key))
        );
        if (missingKeys.length === 0) {
            return;
        }
        if (!this.sitePlan.keyResolver) {
            throw new Error("No encryption key resolver is available for this playlist.");
        }
        const resolved = await this.sitePlan.keyResolver({
            keyUrls: missingKeys,
            explicitKeys: context.explicitKey ? context.explicitKey.split(",") : [],
            playlistUrl: this.playlist.m3u8Url,
        });
        context.keys.setMany(resolved);
    }

    private takeNewChunks(chunks: M3U8Chunk[]): M3U8Chunk[] {
        return chunks.filter((chunk) => {
            if (isNormalChunk(chunk)) {
                // Media sequence is stable across sliding live windows and is the canonical segment identity.
                if (this.sequenceIds.has(chunk.sequenceId)) {
                    return false;
                }
                this.sequenceIds.add(chunk.sequenceId);
                return true;
            }
            // Initialization segments have no media sequence, so their resolved URL is their identity.
            if (this.initialChunkUrls.has(chunk.url)) {
                return false;
            }
            this.initialChunkUrls.add(chunk.url);
            return true;
        });
    }

    private toItems(chunks: M3U8Chunk[]): DownloadItem[] {
        return chunks.map((chunk) => ({
            chunk,
            // Resolve now: the playlist URL can change on a later refresh while this item is still queued.
            ...(chunk.isEncrypted ? { encryptionKeyUrl: buildFullUrl(this.playlist.m3u8Url, chunk.key) } : {}),
        }));
    }
}

export function createHLSSource(sourcePath: string, options: HLSSourceOptions): HLSSource {
    return new HLSSource(sourcePath, options);
}

function sliceItems(items: DownloadItem[], slice?: HLSSourceOptions["slice"]): DownloadItem[] {
    if (!slice) {
        return items;
    }

    const selected: DownloadItem[] = [];
    let currentTime = 0;
    for (const item of items) {
        if (currentTime >= slice.end) {
            break;
        }
        if (isInitialChunk(item.chunk)) {
            // A selected fragmented-MP4 range is unusable without its initialization segment.
            selected.push(item);
            continue;
        }
        const itemStart = currentTime;
        const itemEnd = currentTime + item.chunk.length;
        currentTime = itemEnd;
        if (itemEnd > slice.start && itemStart < slice.end) {
            selected.push(item);
        }
    }
    return selected;
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
        throw new Error("Source preparation was aborted.");
    }
}

function waitForNextCheck(milliseconds: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) {
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        const eventSignal = signal as AbortSignal & {
            addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
            removeEventListener(type: "abort", listener: () => void): void;
        };
        const onAbort = () => {
            clearTimeout(timer);
            resolve(false);
        };
        const timer = setTimeout(() => {
            eventSignal.removeEventListener("abort", onAbort);
            resolve(true);
        }, milliseconds);
        eventSignal.addEventListener("abort", onAbort, { once: true });
    });
}
