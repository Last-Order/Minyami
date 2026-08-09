import * as path from "path";
import logger from "../../utils/log";
import { DownloaderConfig } from "../downloader";
import { normalizeOutputBasePath } from "../media_container";
import { createDefaultMuxers, Muxer } from "../muxer";

export interface NormalizedDownloaderConfig {
    threads: number;
    outputBasePath: string;
    tempPath: string;
    key?: string;
    verbose: boolean;
    retries: number;
    proxy: string;
    cookies?: string;
    headers: Record<string, string>;
    noMerge: boolean;
    cliMode: boolean;
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
    if (config.noMerge) {
        logger.warning("Chunks will not be merged.");
        logger.warning("Temporary files will not be deleted automatically.");
    } else if (config.keep) {
        logger.warning("Temporary files will not be deleted automatically.");
    }

    if (config.keepEncryptedChunks) {
        logger.info("Encrypted chunks will not be deleted automatically.");
        if (!config.noMerge) {
            logger.warning("--keep-encrypted-chunks should be used with --keep.");
        }
    }

    return {
        threads: config.threads || 5,
        outputBasePath: normalizeOutputBasePath(config.output),
        tempPath: path.resolve(config.tempDir || "."),
        key: config.key,
        verbose: !!config.verbose,
        retries: config.retries || 5,
        proxy: config.proxy || "",
        cookies: config.cookies,
        headers: parseHeaders(config.headers),
        noMerge: !!config.noMerge,
        cliMode: !!config.cliMode,
        keepTemporaryFiles: !!config.keep,
        keepEncryptedChunks: !!config.keepEncryptedChunks,
        muxers: config.muxers === undefined ? createDefaultMuxers() : [...config.muxers],
    };
}
