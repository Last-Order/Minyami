import logger from "../../../utils/log";
import { buildFullUrl } from "../../../utils/common";
import { SiteAdapterMode, SiteAdapterResult } from "./adapters/types";
import { isInitialChunk, isNormalChunk, HLSChunk, MasterPlaylist, MediaPlaylist } from "./parser";
import { PlaylistLoader } from "./playlist_loader";
import { prepareSite } from "./site_adapter";
import {
    DownloadEncryption,
    DownloadItem,
    DownloadSource,
    DownloadSourceContext,
    SourceBatch,
    SourceMetadata,
} from "../types";

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
    private playlist?: MediaPlaylist;
    private sitePlan: SiteAdapterResult = {};
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
            throw new Error("Missing HLS source path.");
        }
        throwIfAborted(signal);
        this.loader = new PlaylistLoader(context.http);
        this.playlist = await this.loadMediaPlaylist(this.sourcePath, context);
        if (this.continuous) {
            this.updateFollowTimeouts();
        }

        this.sitePlan = await prepareSite({
            mode: this.parserMode,
            sourcePath: this.sourcePath,
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
            itemNamer: this.sitePlan.itemNamer,
            itemTimeout: this.continuous ? this.followItemTimeout : undefined,
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
                    logger.info("HLS playlist is no longer available. Stop downloading.");
                    return;
                }
                logger.warning("Unable to refresh M3U8 file. Keep the current playlist and retry later.");
            }
        }
    }

    private get parserMode(): SiteAdapterMode {
        return this.continuous ? "live" : "archive";
    }

    private get safeChunkLength(): number {
        const chunkLength = this.playlist?.getChunkLength();
        return Number.isFinite(chunkLength) && chunkLength > 0 ? chunkLength : 5;
    }

    private get followItemTimeout(): number {
        return Math.min(this.safeChunkLength * 1000 * 20, 60000);
    }

    private updateFollowTimeouts(): void {
        this.timeout = Math.min(Math.max(20000, this.playlist.chunks.length * this.safeChunkLength * 1000), 60000);
    }

    private async loadMediaPlaylist(
        sourcePath: string,
        context: DownloadSourceContext,
        initPrimaryKey?: number
    ): Promise<MediaPlaylist> {
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
            (key) => !context.keys.has(buildFullUrl(this.playlist.playlistUrl, key))
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
            playlistUrl: this.playlist.playlistUrl,
        });
        context.keys.setMany(resolved);
    }

    private takeNewChunks(chunks: HLSChunk[]): HLSChunk[] {
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

    private toItems(chunks: HLSChunk[]): DownloadItem[] {
        return chunks.map((chunk) => {
            const encryption = this.toEncryption(chunk);
            if (isInitialChunk(chunk)) {
                return {
                    url: chunk.url,
                    kind: "init",
                    ...(encryption ? { encryption } : {}),
                };
            }
            return {
                url: chunk.url,
                kind: "media",
                duration: chunk.length,
                ...(encryption ? { encryption } : {}),
            };
        });
    }

    private toEncryption(chunk: HLSChunk): DownloadEncryption | undefined {
        if (!chunk.isEncrypted) {
            return undefined;
        }
        return {
            scheme: "aes-128-cbc",
            // Resolve now: the playlist URL can change on a later refresh while this item is still queued.
            keyId: buildFullUrl(this.playlist.playlistUrl, chunk.key),
            // HLS derives an omitted media IV from its sequence; executors should not know that protocol rule.
            iv: isInitialChunk(chunk) ? chunk.iv : chunk.iv || chunk.sequenceId.toString(16),
        };
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
        if (item.kind === "init") {
            // A selected fragmented-MP4 range is unusable without its initialization segment.
            selected.push(item);
            continue;
        }
        const itemStart = currentTime;
        const itemEnd = currentTime + item.duration;
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
