import * as path from "path";
import logger from "../../utils/log";
import { decrypt } from "../../utils/media";
import { DownloadTask } from "../downloader";
import { DownloadHttpClient } from "./http_client";
import { KeyStore } from "./key_store";

export interface ExecuteChunkOptions {
    tempPath: string;
    itemTimeout: number;
    keepEncryptedChunks: boolean;
}

export interface ChunkResult {
    outputPath: string;
}

export class ChunkExecutor {
    constructor(private readonly http: DownloadHttpClient, private readonly keys: KeyStore) {}

    async execute(task: DownloadTask, options: ExecuteChunkOptions): Promise<ChunkResult> {
        const { item } = task;
        logger.debug(`Downloading ${item.url}`);
        logger.debug(`Downloading ${task.filename}`);
        const downloadedPath = path.resolve(options.tempPath, task.filename);
        const timeout = Math.min(((task.retryCount || 0) + 1) * options.itemTimeout, options.itemTimeout * 5);

        try {
            await this.http.download(item.url, downloadedPath, { timeout });
            logger.debug(`Downloading ${task.filename} succeed.`);

            if (!item.encryption) {
                return { outputPath: downloadedPath };
            }

            // Sources resolve protocol-specific key identities and IV defaults before an item reaches execution.
            const key = this.keys.get(item.encryption.keyId);
            if (!key) {
                throw new Error(`Missing encryption key for ${item.encryption.keyId}`);
            }
            const decryptedPath = downloadedPath + ".decrypt";
            await decrypt(downloadedPath, decryptedPath, key, item.encryption.iv, options.keepEncryptedChunks);
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
