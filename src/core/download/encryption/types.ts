import { DownloadEncryption } from "@/core/source/types";

export interface DecryptionRequest {
    readonly inputPath: string;
    readonly outputPath: string;
    readonly encryption: DownloadEncryption;
    readonly keys: ReadonlyMap<string, string>;
    readonly signal: AbortSignal;
}

export class FatalDecryptionError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "FatalDecryptionError";
    }
}

/**
 * Performs one algorithm-specific file transformation. Downloading, retries,
 * source cleanup, task naming, and output merging remain executor concerns.
 */
export interface EncryptionHandler {
    readonly scheme: DownloadEncryption["scheme"];

    keyIds(encryption: DownloadEncryption): readonly string[];

    /** Rejects unusable descriptors before their media item is downloaded. */
    validate(encryption: DownloadEncryption, keys: ReadonlyMap<string, string>): void;

    /** Commits a complete output file or rejects without removing the input. */
    decrypt(request: DecryptionRequest): Promise<void>;
}
