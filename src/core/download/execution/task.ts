import { DownloadItem, DownloadTrackId } from "@/core/source/types";

/** Runtime work assigned by the session after protocol-neutral discovery. */
export interface DownloadTask {
    /** Global discovery order shared by every track. */
    readonly id: number;
    readonly trackId: DownloadTrackId;
    /** Merge order within this task's track. */
    readonly trackIndex: number;
    readonly filename: string;
    readonly item: DownloadItem;
}
