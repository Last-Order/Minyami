import { DownloadEncryption } from "../../source/types";

export interface DecryptionRequest {
    readonly inputPath: string;
    readonly outputPath: string;
    readonly encryption: DownloadEncryption;
    readonly key: string;
}

/**
 * Performs one algorithm-specific file transformation. Downloading, retries,
 * source cleanup, task naming, and output merging remain executor concerns.
 */
export interface EncryptionHandler {
    readonly scheme: DownloadEncryption["scheme"];

    /** Rejects unusable descriptors before their media item is downloaded. */
    validate(encryption: DownloadEncryption, key: string): void;

    /** Commits a complete output file or rejects without removing the input. */
    decrypt(request: DecryptionRequest): Promise<void>;
}
