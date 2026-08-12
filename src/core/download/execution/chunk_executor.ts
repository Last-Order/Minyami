import * as fs from "fs";
import * as path from "path";
import logger from "../../../utils/log";
import { EncryptionHandlerRegistry } from "../encryption/registry";
import { DownloadHttpClient } from "../infrastructure/http_client";
import { KeyStore } from "../infrastructure/key_store";
import { DownloadTask } from "./task";

export interface ExecuteChunkOptions {
    tempPath: string;
    itemTimeout: number;
    keepEncryptedChunks: boolean;
    attempt: number;
    signal: AbortSignal;
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
        // Later attempts tolerate slow media, but the cap prevents one task from blocking shutdown indefinitely.
        const timeout = Math.min(options.attempt * options.itemTimeout, options.itemTimeout * 5);

        try {
            await this.http.download(item.url, downloadedPath, { timeout, signal: options.signal });
            logger.debug(`Downloading ${task.filename} succeed.`);

            if (!item.encryption) {
                return { outputPath: downloadedPath };
            }

            // Decrypt beside the encrypted input so a failed transform never replaces recoverable source bytes.
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
            // Only the fully downloaded/decrypted path is admitted to ordered output by the session.
            return { outputPath: decryptedPath };
        } catch (error) {
            if (options.signal.aborted) {
                logger.debug(`Processing ${task.filename} was aborted.`);
                throw error;
            }
            const reason = describeFailure(error);
            logger.warning(`Downloading or decrypting ${task.filename} failed. Retry later. [${reason}]`);
            logger.debug(error);
            throw error;
        }
    }
}

function describeFailure(error: unknown): string {
    if (typeof error !== "object" || error === null) {
        return String(error) || "UNKNOWN";
    }

    const details = error as Record<string, unknown>;
    if (typeof details.code === "string" && details.code) {
        return details.code;
    }
    if (typeof details.response === "object" && details.response !== null) {
        const response = details.response as Record<string, unknown>;
        if (response.status !== undefined) {
            return `${String(response.status)} ${String(response.statusText ?? "")}`.trim();
        }
    }
    if (error instanceof Error) {
        return error.message || error.constructor.name;
    }
    return "UNKNOWN";
}
