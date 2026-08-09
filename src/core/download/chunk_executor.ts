import * as fs from "fs";
import * as path from "path";
import logger from "../../utils/log";
import { DownloadTask } from "../downloader";
import { EncryptionHandlerRegistry } from "./encryption/registry";
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
    constructor(
        private readonly http: DownloadHttpClient,
        private readonly keys: KeyStore,
        private readonly encryptionHandlers: EncryptionHandlerRegistry
    ) {}

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

            const handler = this.encryptionHandlers.require(item.encryption.scheme);
            const key = this.keys.get(item.encryption.keyId);
            if (!key) {
                throw new Error(`Missing encryption key for ${item.encryption.keyId}`);
            }
            const decryptedPath = downloadedPath + ".decrypt";
            await handler.decrypt({
                inputPath: downloadedPath,
                outputPath: decryptedPath,
                encryption: item.encryption,
                key,
            });
            if (!options.keepEncryptedChunks) {
                try {
                    // Cleanup policy stays outside handlers so algorithms only own the file transformation.
                    await fs.promises.unlink(downloadedPath);
                } catch (error) {
                    logger.warning(`Unable to delete encrypted chunk ${task.filename}.`);
                    logger.debug(error);
                }
            }
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
