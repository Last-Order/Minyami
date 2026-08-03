import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";
import logger from "../../utils/log";
import { buildFullUrl, getAvailableOutputPath } from "../../utils/common";
import FileConcentrator, { TaskStatus } from "../file_concentrator";
import { DownloadTask, DownloaderConfig } from "../downloader";
import { MasterPlaylist, Playlist } from "../m3u8";
import { ParserMode, ParserResult } from "../parsers/types";
import { ChunkExecutor, ChunkResult } from "./chunk_executor";
import { ChunkNamer, createChunkNamer } from "./chunk_naming";
import { normalizeDownloaderConfig, NormalizedDownloaderConfig } from "./config";
import { DownloadHttpClient } from "./http_client";
import { KeyStore } from "./key_store";
import { PlaylistLoader } from "./playlist_loader";
import { ProgressTracker } from "./progress";
import { prepareSite } from "./site_adapter";

export interface ExecutedChunk extends ChunkResult {
    task: DownloadTask;
}

export class DownloadRuntime {
    readonly config: NormalizedDownloaderConfig;
    readonly http: DownloadHttpClient;
    readonly keys = new KeyStore();
    readonly progress = new ProgressTracker();
    readonly taskStatusRecord: TaskStatus[] = [];
    readonly playlistLoader: PlaylistLoader;
    readonly chunkExecutor: ChunkExecutor;

    sourcePath?: string;
    tempPath: string;
    outputPath: string;
    playlist?: Playlist;
    totalChunkLength = 0;
    timeout = 60000;
    chunkTimeout = 60000;
    fileConcentrator?: FileConcentrator;

    private outputPrepared = false;
    private chunkNamer: ChunkNamer;
    private sitePlan: ParserResult = {};

    constructor(sourcePath: string | undefined, config: DownloaderConfig = {}) {
        this.sourcePath = sourcePath;
        this.config = normalizeDownloaderConfig(config);
        this.tempPath = this.config.tempPath;
        this.outputPath = this.config.outputPath;
        this.http = new DownloadHttpClient(this.config);
        this.playlistLoader = new PlaylistLoader(this.http);
        this.chunkExecutor = new ChunkExecutor(this.http, this.keys);
        this.chunkNamer = createChunkNamer(this.config.chunkNamingStrategy);
    }

    async loadInitialPlaylist(): Promise<Playlist> {
        if (!this.sourcePath) {
            throw new Error("Missing M3U8 path.");
        }
        const loaded = await this.playlistLoader.load(this.sourcePath, {
            retries: this.config.retries,
            timeout: this.timeout,
        });
        this.playlist = await this.selectMediaPlaylist(loaded);
        this.totalChunkLength = this.playlist.getTotalChunkLength();
        return this.playlist;
    }

    async refreshPlaylist(initPrimaryKey?: number): Promise<Playlist> {
        if (!this.sourcePath) {
            throw new Error("Missing M3U8 path.");
        }
        const loaded = await this.playlistLoader.load(this.sourcePath, {
            retries: this.config.retries,
            timeout: this.timeout,
            initPrimaryKey,
        });
        this.playlist = await this.selectMediaPlaylist(loaded);
        return this.playlist;
    }

    async prepareSite(mode: ParserMode): Promise<ParserResult> {
        if (!this.playlist || !this.sourcePath) {
            throw new Error("Playlist must be loaded before selecting a site adapter.");
        }
        this.sitePlan = await prepareSite({
            mode,
            m3u8Path: this.sourcePath,
            playlist: this.playlist,
            key: this.config.key,
            retries: this.config.retries,
            http: this.http,
        });
        if (this.sitePlan.chunks) {
            this.playlist.chunks = this.sitePlan.chunks;
        }
        if (this.sitePlan.encryptionKeys) {
            this.keys.setMany(this.sitePlan.encryptionKeys);
        }
        if (this.sitePlan.chunkNamer) {
            this.chunkNamer = this.sitePlan.chunkNamer;
        }
        return this.sitePlan;
    }

    async checkKeys(): Promise<void> {
        if (!this.playlist || this.playlist.encryptKeys.length === 0) {
            return;
        }
        const missingKeys = this.playlist.encryptKeys.filter(
            (key) => !this.keys.has(buildFullUrl(this.playlist.m3u8Url, key))
        );
        if (missingKeys.length === 0) {
            return;
        }
        if (!this.sitePlan.keyResolver) {
            throw new Error("No encryption key resolver is available for this playlist.");
        }
        const resolved = await this.sitePlan.keyResolver({
            keyUrls: missingKeys,
            explicitKeys: this.config.key ? this.config.key.split(",") : [],
            playlistUrl: this.playlist.m3u8Url,
        });
        this.keys.setMany(resolved);
    }

    async allocateWorkspace(): Promise<void> {
        this.validateTemporaryBasePath();
        this.tempPath = path.resolve(this.tempPath, `minyami_${Date.now()}_${randomBytes(4).toString("hex")}`);
        fs.mkdirSync(this.tempPath);
        this.prepareOutput();
    }

    useExistingWorkspace(tempPath: string, outputPath: string): void {
        this.tempPath = tempPath;
        this.outputPath = outputPath;
        if (!fs.existsSync(this.tempPath)) {
            throw new Error(`Temporary path '${this.tempPath}' does not exist.`);
        }
        this.prepareOutput(false);
    }

    nameChunk(task: DownloadTask["chunk"], id: number): string {
        return this.chunkNamer(task, id);
    }

    get dropChunksOnMaxRetries(): boolean {
        return !!this.sitePlan.dropChunksOnMaxRetries;
    }

    async execute(task: DownloadTask): Promise<ExecutedChunk> {
        if (!this.playlist) {
            throw new Error("Cannot execute a chunk before loading its playlist.");
        }
        const result = await this.chunkExecutor.execute(task, {
            tempPath: this.tempPath,
            playlistUrl: this.playlist.m3u8Url,
            chunkTimeout: this.chunkTimeout,
            keepEncryptedChunks: this.config.keepEncryptedChunks,
        });
        return { ...result, task };
    }

    recordFinished(task: DownloadTask): void {
        this.progress.recordFinished(task);
    }

    markOutputReady(task: DownloadTask, outputPath: string): void {
        if (this.config.noMerge) {
            return;
        }
        this.fileConcentrator.addTasks([{ filePath: outputPath, index: task.id }]);
        this.taskStatusRecord[task.id] = TaskStatus.DONE;
    }

    markDropped(task: DownloadTask): void {
        this.taskStatusRecord[task.id] = TaskStatus.DROPPED;
    }

    async finishOutput(): Promise<string[]> {
        if (this.config.noMerge) {
            return [];
        }
        await this.fileConcentrator.waitAllFilesWritten();
        return this.fileConcentrator.getOutputFilePaths();
    }

    private validateTemporaryBasePath(): void {
        if (!fs.existsSync(this.tempPath)) {
            throw new Error("Temporary path directory not exists.");
        }
    }

    private prepareOutput(selectAvailablePath = true): void {
        if (this.outputPrepared || this.config.noMerge) {
            return;
        }
        if (selectAvailablePath) {
            this.outputPath = getAvailableOutputPath(this.outputPath);
        }
        this.fileConcentrator = new FileConcentrator({
            outputPath: this.outputPath,
            taskStatusRecord: this.taskStatusRecord,
            deleteAfterWritten: !this.config.keepTemporaryFiles,
        });
        this.outputPrepared = true;
    }

    private async selectMediaPlaylist(playlist: MasterPlaylist | Playlist): Promise<Playlist> {
        if (!(playlist instanceof MasterPlaylist)) {
            return playlist;
        }
        const bestStream = [...playlist.streams].sort((a, b) => b.bandwidth - a.bandwidth)[0];
        if (!bestStream) {
            throw new Error("Master playlist does not contain any streams.");
        }
        logger.info("Master playlist input detected. Auto selecting best quality streams.");
        logger.debug(`Best stream: ${bestStream.url}; Bandwidth: ${bestStream.bandwidth}`);
        this.sourcePath = bestStream.url;
        return (await this.playlistLoader.load(bestStream.url, {
            retries: this.config.retries,
            timeout: this.timeout,
        })) as Playlist;
    }
}
