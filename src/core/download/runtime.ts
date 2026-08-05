import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";
import { getAvailableOutputPath } from "../../utils/common";
import FileConcentrator, { TaskStatus } from "../file_concentrator";
import { DownloadTask, DownloaderConfig } from "../downloader";
import { ChunkExecutor, ChunkResult } from "./chunk_executor";
import { ChunkNamer, createChunkNamer } from "./chunk_naming";
import { normalizeDownloaderConfig, NormalizedDownloaderConfig } from "./config";
import { DownloadHttpClient } from "./http_client";
import { KeyStore } from "./key_store";
import { ProgressTracker } from "./progress";

export interface ExecutedChunk extends ChunkResult {
    task: DownloadTask;
}

export class DownloadRuntime {
    readonly config: NormalizedDownloaderConfig;
    readonly http: DownloadHttpClient;
    readonly keys = new KeyStore();
    readonly progress = new ProgressTracker();
    readonly taskStatusRecord: TaskStatus[] = [];
    readonly chunkExecutor: ChunkExecutor;

    sourcePath = "";
    tempPath: string;
    outputPath: string;
    chunkTimeout = 60000;
    fileConcentrator?: FileConcentrator;

    private outputPrepared = false;
    private chunkNamer: ChunkNamer;

    constructor(config: DownloaderConfig = {}) {
        this.config = normalizeDownloaderConfig(config);
        this.tempPath = this.config.tempPath;
        this.outputPath = this.config.outputPath;
        this.http = new DownloadHttpClient(this.config);
        this.chunkExecutor = new ChunkExecutor(this.http, this.keys);
        this.chunkNamer = createChunkNamer(this.config.chunkNamingStrategy);
    }

    async allocateWorkspace(): Promise<void> {
        this.validateTemporaryBasePath();
        this.tempPath = path.resolve(this.tempPath, `minyami_${Date.now()}_${randomBytes(4).toString("hex")}`);
        fs.mkdirSync(this.tempPath);
        this.prepareOutput();
    }

    nameChunk(task: DownloadTask["chunk"], id: number): string {
        return this.chunkNamer(task, id);
    }

    setChunkNamer(chunkNamer: ChunkNamer): void {
        // Naming is source metadata; task ids and the moment filenames are assigned remain downloader-owned.
        this.chunkNamer = chunkNamer;
    }

    async execute(task: DownloadTask): Promise<ExecutedChunk> {
        const result = await this.chunkExecutor.execute(task, {
            tempPath: this.tempPath,
            chunkTimeout: this.chunkTimeout,
            keepEncryptedChunks: this.config.keepEncryptedChunks,
        });
        return { ...result, task };
    }

    recordTaskSuccess(task: DownloadTask): void {
        this.progress.recordSuccessful(task);
    }

    markOutputReady(task: DownloadTask, outputPath: string): void {
        if (this.config.noMerge) {
            return;
        }
        this.fileConcentrator.addTasks([{ filePath: outputPath, index: task.id }]);
        this.taskStatusRecord[task.id] = TaskStatus.DONE;
    }

    recordTaskFailure(task: DownloadTask): "retry" | "drop" {
        task.retryCount = task.retryCount ? task.retryCount + 1 : 1;
        if (task.retryCount < this.config.retries) {
            return "retry";
        }
        this.taskStatusRecord[task.id] = TaskStatus.DROPPED;
        this.progress.recordDropped();
        return "drop";
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

    private prepareOutput(): void {
        if (this.outputPrepared || this.config.noMerge) {
            return;
        }
        this.outputPath = getAvailableOutputPath(this.outputPath);
        this.fileConcentrator = new FileConcentrator({
            outputPath: this.outputPath,
            taskStatusRecord: this.taskStatusRecord,
            deleteAfterWritten: !this.config.keepTemporaryFiles,
        });
        this.outputPrepared = true;
    }
}
