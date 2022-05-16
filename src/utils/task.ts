import * as fs from "fs";
import * as path from "path";
import { ChunkItem } from "../core/downloader";

export interface MinyamiTask {
    /** 唯一标识符 */
    id: string;

    /** 临时文件目录 */
    tempPath: string;
    /** m3u8文件路径 */
    m3u8Path: string;

    /** 输出目录 */
    outputPath: string;
    /** 并发数量 */
    threads: number;

    /** Cookie */
    cookies: string;
    /** HTTP Headers */
    headers: Record<string, string>;
    key: string;

    /** 是否打印调试信息 */
    verbose: boolean;

    /** 开始下载时间 */
    startedAt: number;
    /** 已完成的块数量 */
    finishedChunksCount: number;
    /** 已完成的块总长度 */
    finishedChunkLength: number;
    /** 全部块数量 */
    totalChunksCount: number;

    /** 重试次数 */
    retries: number;
    /** 超时时间 */
    timeout: number;

    proxy: string;

    /** 全部块 */
    allChunks: ChunkItem[];
    /** 未下载的块 */
    chunks: ChunkItem[];
    /** 输出文件列表 */
    outputFileList: string[];
    /** 已完成文件名 */
    finishedFilenames: { [index: string]: any };
}

/**
 * Get previous task
 * @param taskId
 */
export function getTask(taskId: string): MinyamiTask {
    const taskFilePath = path.resolve(__dirname, "../../tasks.json");
    if (!fs.existsSync(taskFilePath)) {
        return;
    }

    const taskFileContent = fs.readFileSync(taskFilePath).toString();
    try {
        const previousTasks = JSON.parse(taskFileContent);
        const index = previousTasks.findIndex((t) => {
            return t.id === taskId;
        });
        if (index === -1) {
            return;
        }
        return previousTasks[index];
    } catch (e) {
        return;
    }
}

/**
 * Save(add) or update task
 * @param task
 */
export function saveTask(task: MinyamiTask) {
    const taskFilePath = path.resolve(__dirname, "../../tasks.json");
    const tasks = [];
    if (fs.existsSync(taskFilePath)) {
        const taskFileContent = fs.readFileSync(taskFilePath).toString();
        try {
            const previousTasks = JSON.parse(taskFileContent);
            tasks.push(...previousTasks);
        } catch (e) {
            throw new Error("Fail to parse previous tasks, ignored. " + e);
        }
    }

    const index = tasks.findIndex((t) => t.id === task.id);

    if (index !== -1) {
        // Update previous task
        tasks[index] = task;
    } else {
        tasks.push(task);
    }

    // Write back to file
    fs.writeFileSync(taskFilePath, JSON.stringify(tasks, null, 2));
}

/**
 * Delete task
 * @param taskId
 */
export function deleteTask(taskId: string): boolean {
    const taskFilePath = path.resolve(__dirname, "../../tasks.json");
    const tasks = [];

    if (!fs.existsSync(taskFilePath)) {
        // No previous tasks. No task to delete.
        return false;
    }

    const taskFileContent = fs.readFileSync(taskFilePath).toString();
    try {
        const previousTasks = JSON.parse(taskFileContent);
        tasks.push(...previousTasks);
    } catch (e) {
        throw new Error("Fail to parse previous tasks, ignored. " + e);
    }

    const index = tasks.findIndex((t) => t.id === taskId);

    if (index === -1) {
        return false;
    } else {
        // Write back to file
        fs.writeFileSync(
            taskFilePath,
            JSON.stringify(
                tasks.filter((t) => t.id !== taskId),
                null,
                2
            )
        );
    }
}
