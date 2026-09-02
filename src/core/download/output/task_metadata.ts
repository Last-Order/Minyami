import * as fs from "fs";
import { MediaContainer } from "@/core/media_container";
import { MediaTrack } from "@/core/source/stream_selection";
import { DownloadTrackId } from "@/core/source/types";

export const TASK_METADATA_FILENAME = "task.json";

export interface TaskMetadataTrack {
    readonly id: DownloadTrackId;
    readonly mediaTrack: MediaTrack;
    readonly sourcePath: string;
    readonly container: MediaContainer;
    readonly tempPath: string;
    readonly plannedOutputPath: string;
}

export interface TaskMetadata {
    /** Allows a future recovery reader to reject layouts it cannot safely interpret. */
    readonly schemaVersion: 1;
    readonly sourcePath: string;
    readonly continuous: boolean;
    readonly tempPath: string;
    readonly outputBasePath: string;
    readonly startedAt: number;
    /** Authentication material and keys are deliberately excluded from the on-disk record. */
    readonly configuration: {
        readonly threads: number;
        readonly sourceRequestAttempts: number;
        readonly taskAttempts: number;
        readonly noMerge: boolean;
        readonly keepTemporaryFiles: boolean;
        readonly keepEncryptedChunks: boolean;
    };
    readonly sourceContainer?: MediaContainer;
    readonly tracks: readonly TaskMetadataTrack[];
}

/** Atomically replaces the recovery record so interruption cannot publish partial JSON. */
export function writeTaskMetadata(filePath: string, metadata: TaskMetadata): void {
    const temporaryPath = `${filePath}.t`;
    try {
        fs.writeFileSync(temporaryPath, `${JSON.stringify(metadata, null, 4)}\n`);
        fs.renameSync(temporaryPath, filePath);
    } catch (error) {
        fs.rmSync(temporaryPath, { force: true });
        throw error;
    }
}
