import * as os from "os";
import * as path from "path";
import logger from "../../utils/log";
import { NamingStrategy } from "../types";
import { DownloaderConfig } from "../downloader";

export interface NormalizedDownloaderConfig {
    threads: number;
    outputPath: string;
    tempPath: string;
    key?: string;
    verbose: boolean;
    retries: number;
    proxy: string;
    format: string;
    cookies?: string;
    headers: Record<string, string>;
    noMerge: boolean;
    cliMode: boolean;
    keepTemporaryFiles: boolean;
    keepEncryptedChunks: boolean;
    chunkNamingStrategy: NamingStrategy;
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
    const format = config.format || "ts";
    let outputPath = config.output || "./output.ts";

    if (format === "ts" && outputPath.endsWith(".mkv")) {
        logger.warning("Output file name ends with .mkv is not supported in direct muxing mode, auto changing to .ts.");
        outputPath += ".ts";
    }

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
        outputPath,
        tempPath: path.resolve(config.tempDir || os.tmpdir()),
        key: config.key,
        verbose: !!config.verbose,
        retries: config.retries || 5,
        proxy: config.proxy || "",
        format,
        cookies: config.cookies,
        headers: parseHeaders(config.headers),
        noMerge: !!config.noMerge,
        cliMode: !!config.cliMode,
        keepTemporaryFiles: !!config.keep,
        keepEncryptedChunks: !!config.keepEncryptedChunks,
        chunkNamingStrategy:
            config.chunkNamingStrategy === undefined
                ? NamingStrategy.MIXED
                : (+config.chunkNamingStrategy as NamingStrategy),
    };
}
