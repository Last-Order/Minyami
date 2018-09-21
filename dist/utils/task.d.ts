import { Chunk } from '../core/downloader';
export interface MinyamiTask {
    id: string;
    tempPath: string;
    m3u8Path: string;
    outputPath: string;
    threads: number;
    key: string;
    iv: string;
    verbose: boolean;
    nomux: boolean;
    startedAt: number;
    finishedChunksCount: number;
    totalChunksCount: number;
    retries: number;
    timeout: number;
    proxy: string;
    proxyHost: string;
    proxyPort: number;
    chunks: Chunk[];
    outputFileList: string[];
}
/**
 * Get previous task
 * @param taskId
 */
export declare function getTask(taskId: string): MinyamiTask;
/**
 * Save(add) or update task
 * @param task
 */
export declare function saveTask(task: MinyamiTask): void;
/**
 * Delete task
 * @param taskId
 */
export declare function deleteTask(taskId: string): boolean;
