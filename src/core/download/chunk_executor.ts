import * as path from "path";
import logger from "../../utils/log";
import { decrypt } from "../../utils/media";
import { DownloadTask } from "../downloader";
import { isInitialChunk } from "../m3u8";
import { DownloadHttpClient } from "./http_client";
import { KeyStore } from "./key_store";

export interface ExecuteChunkOptions {
    tempPath: string;
    chunkTimeout: number;
    keepEncryptedChunks: boolean;
}

export interface ChunkResult {
    outputPath: string;
}

export class ChunkExecutor {
    constructor(private readonly http: DownloadHttpClient, private readonly keys: KeyStore) {}

    async execute(task: DownloadTask, options: ExecuteChunkOptions): Promise<ChunkResult> {
        logger.debug(`Downloading ${task.chunk.url}`);
        logger.debug(`Downloading ${task.filename}`);
        const encryptedPath = path.resolve(options.tempPath, task.filename);
        const timeout = Math.min(((task.retryCount || 0) + 1) * options.chunkTimeout, options.chunkTimeout * 5);

        try {
            await this.http.download(task.chunk.url, encryptedPath, { timeout });
            logger.debug(`Downloading ${task.filename} succeed.`);

            if (!task.chunk.isEncrypted) {
                return { outputPath: encryptedPath };
            }

            const decryptIV = isInitialChunk(task.chunk)
                ? task.chunk.iv
                : task.chunk.iv || task.chunk.sequenceId.toString(16);
            // The item carries an absolute key URL so execution is independent of later playlist refreshes.
            const keyUrl = task.encryptionKeyUrl;
            if (!keyUrl) {
                throw new Error(`Missing encryption key URL for ${task.chunk.url}`);
            }
            const key = this.keys.get(keyUrl);
            if (!key) {
                throw new Error(`Missing encryption key for ${keyUrl}`);
            }
            const decryptedPath = encryptedPath + ".decrypt";
            await decrypt(encryptedPath, decryptedPath, key, decryptIV, options.keepEncryptedChunks);
            logger.debug(`Decrypting ${task.filename} succeed`);
            return { outputPath: decryptedPath };
        } catch (error) {
            const e = error as any;
            const reason =
                e.code ||
                (e.response ? `${e.response.status} ${e.response.statusText}` : undefined) ||
                e.message ||
                e.constructor?.name ||
                "UNKNOWN";
            logger.warning(`Downloading or decrypting ${task.filename} failed. Retry later. [${reason}]`);
            logger.debug(e);
            throw error;
        }
    }
}
