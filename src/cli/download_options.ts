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
    validateCliOptions(merged);
    return merged;
}

function validateCliOptions(options: Readonly<Record<string, unknown>>): void {
    const requireType = (key: string, type: "boolean" | "string") => {
        if (options[key] !== undefined && typeof options[key] !== type) {
            throw new Error(`Option ${key} must be a ${type}.`);
        }
    };
    for (const key of ["verbose", "noProxy", "noMerge", "keep", "keepEncryptedChunks", "live"]) {
        requireType(key, "boolean");
    }
    for (const key of ["output", "tempDir", "cookies", "proxy", "slice"]) {
        requireType(key, "string");
    }
    for (const key of ["threads", "retries"]) {
        const value = options[key];
        if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)) {
            throw new Error(`Option ${key} must be a positive integer.`);
        }
    }
    for (const key of ["headers", "key"]) {
        const value = options[key];
        if (
            value !== undefined &&
            typeof value !== "string" &&
            !(Array.isArray(value) && value.every((item: unknown) => typeof item === "string"))
        ) {
            throw new Error(`Option ${key} must be a string or an array of strings.`);
        }
    }
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
