import * as path from "path";
import logger from "../../utils/log";
import { normalizeOutputBasePath } from "../media_container";
import { createDefaultMuxers, Muxer } from "../muxer";
import { DownloaderConfig } from "./types";

export interface NormalizedDownloaderConfig {
    threads: number;
    outputBasePath: string;
    tempPath: string;
    sourceRequestAttempts: number;
    taskAttempts: number;
    proxy: string;
    cookies?: string;
    headers: Record<string, string>;
    noMerge: boolean;
    keepTemporaryFiles: boolean;
    keepEncryptedChunks: boolean;
    muxers: readonly Muxer[];
}

function parseHeaders(headers?: string | string[]): Record<string, string> {
    const result: Record<string, string> = {};
    const headerConfig = Array.isArray(headers) ? headers : headers ? [headers] : [];

    for (const value of headerConfig) {
        for (const line of value.split(/\\n|\r?\n/)) {
            const match = /^([^ :]+):(.+)$/.exec(line);
            if (!match) {
                logger.warning("HTTP Headers invalid. Ignored.");
                continue;
            }
            result[match[1]] = match[2].trim();
        }
    }

    return result;
}

export function normalizeDownloaderConfig(config: DownloaderConfig = {}): NormalizedDownloaderConfig {
    const threads = config.threads === undefined ? 5 : Number(config.threads);
    // Source I/O and task execution fail at different boundaries and therefore keep independent attempt budgets.
    const sourceRequestAttempts = config.sourceRequestAttempts === undefined ? 5 : Number(config.sourceRequestAttempts);
    const taskAttempts = config.taskAttempts === undefined ? 5 : Number(config.taskAttempts);
    if (!Number.isSafeInteger(threads) || threads < 1) {
        throw new Error("Downloader thread count must be a positive integer.");
    }
    if (!Number.isSafeInteger(sourceRequestAttempts) || sourceRequestAttempts < 1) {
        throw new Error("Source request attempt count must be a positive integer.");
    }
    if (!Number.isSafeInteger(taskAttempts) || taskAttempts < 1) {
        throw new Error("Task attempt count must be a positive integer.");
    }

    if (config.noMerge) {
        // Unmerged chunks are the requested result, so automatic temporary cleanup would destroy them.
        logger.warning("Chunks will not be merged.");
        logger.warning("Temporary files will not be deleted automatically.");
    } else if (config.keepTemporaryFiles) {
        logger.warning("Temporary files will not be deleted automatically.");
    }

    if (config.keepEncryptedChunks) {
        logger.info("Encrypted chunks will not be deleted automatically.");
        if (!config.noMerge) {
            logger.warning("--keep-encrypted-chunks should be used with --keep.");
        }
    }

    return {
        threads,
        outputBasePath: normalizeOutputBasePath(config.output),
        tempPath: path.resolve(config.tempDir || "."),
        sourceRequestAttempts,
        taskAttempts,
        proxy: config.proxy || "",
        cookies: config.cookies,
        headers: parseHeaders(config.headers),
        noMerge: !!config.noMerge,
        keepTemporaryFiles: !!config.keepTemporaryFiles,
        keepEncryptedChunks: !!config.keepEncryptedChunks,
        muxers: config.muxers === undefined ? createDefaultMuxers() : [...config.muxers],
    };
}
