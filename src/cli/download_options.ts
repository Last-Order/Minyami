import { LiveDownloaderConfig } from "@/core/live";
import { CliOptions } from "./arguments";
import { parseExplicitKeyArguments } from "./explicit_key_arguments";
import { selectStreamInteractively } from "./interactive_stream_selector";

export interface CliDownloadConfiguration {
    readonly live: boolean;
    readonly slice?: string;
    readonly downloader: LiveDownloaderConfig;
}

/** Applies config-file defaults without mutating the command parser's option object. */
export function mergeCliOptions(options: CliOptions, fileOptions: Readonly<Record<string, unknown>>): CliOptions {
    const merged: CliOptions = { ...fileOptions };
    for (const [key, value] of Object.entries(options)) {
        if (value !== undefined) {
            merged[key] = value;
        }
    }
    return merged;
}

/** Explicitly adapts CLI names and policies to the compatibility-sensitive core API. */
export function createCliDownloadConfiguration(options: CliOptions): CliDownloadConfiguration {
    return {
        live: !!options.live,
        slice: options.slice,
        downloader: {
            threads: options.threads,
            output: options.output,
            tempDir: options.tempDir,
            cookies: options.cookies,
            headers: options.headers,
            // The CLI keeps one retry knob while the core enforces separate source-I/O and task budgets.
            sourceRequestAttempts: options.retries,
            taskAttempts: options.retries,
            proxy: options.proxy,
            noMerge: !!options.noMerge,
            keepTemporaryFiles: !!options.keep,
            keepEncryptedChunks: !!options.keepEncryptedChunks,
            explicitKeys: options.key ? parseExplicitKeyArguments(options.key) : undefined,
            streamSelector: selectStreamInteractively,
        },
    };
}
