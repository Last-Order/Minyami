import { M3U8Chunk } from "./m3u8";
import type { ActionType } from "./action";
import { NamingStrategy } from "./types";

export interface DownloaderConfig {
    threads?: number;
    output?: string;
    tempDir?: string;
    key?: string;
    verbose?: boolean;
    cookies?: string;
    headers?: string | string[];
    retries?: number;
    proxy?: string;
    format?: string;
    noMerge?: boolean;
    keep?: boolean;
    keepEncryptedChunks?: boolean;
    chunkNamingStrategy?: NamingStrategy;
    cliMode?: boolean;
}

export interface ArchiveDownloaderConfig extends DownloaderConfig {
    slice?: string;
}

export interface LiveDownloaderConfig extends DownloaderConfig {}

export interface DownloadTask {
    id: number;
    filename: string;
    retryCount: number;
    chunk: M3U8Chunk;
    /** @deprecated Groups are now represented by scheduler barriers. */
    parentGroup?: DownloadTaskGroup;
}

export interface DownloadTaskGroupAction {
    actionName: ActionType;
    actionParams: string;
}

export interface DownloadTaskGroup {
    subTasks: DownloadTask[];
    actions?: DownloadTaskGroupAction[];
    isFinished: boolean;
    isNew: boolean;
    retryActions?: boolean;
}

export type DownloadTaskItem = DownloadTask | DownloadTaskGroup;

export function isTaskGroup(item: DownloadTaskItem): item is DownloadTaskGroup {
    return Array.isArray((item as DownloadTaskGroup).subTasks);
}
