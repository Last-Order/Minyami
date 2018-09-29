import * as fs from 'fs';
import * as path from 'path';
import Logger from '../utils/log';
import { Chunk } from '../core/downloader';
import M3U8 from '../core/m3u8';

export interface MinyamiTask {
    id: string; // 唯一标识符

    tempPath: string; // 临时文件目录
    m3u8Path: string; // m3u8文件路径

    outputPath: string; // 输出目录
    threads: number; // 并发数量

    key: string; // Key
    iv: string; // IV

    verbose: boolean; // 调试输出
    nomux: boolean; // 仅合并分段不remux

    startedAt: number; // 开始下载时间
    finishedChunksCount: number; // 已完成的块数量
    totalChunksCount: number; // 全部块数量

    retries: number; // 重试数量
    timeout: number; // 超时时间

    proxy: string;
    proxyHost: string;
    proxyPort: number;

    allChunks: Chunk[]; // 全部块
    chunks: Chunk[]; // 未下载的块
    outputFileList: string[]; // 输出文件列表
    finishedFilenames: string[]; // 已完成文件名
}

/**
 * Get previous task
 * @param taskId 
 */
export function getTask(taskId: string): MinyamiTask {
    const taskFilePath = path.resolve(__dirname, '../../tasks.json');
    if (!fs.existsSync(taskFilePath)) {
        return;
    }

    const taskFileContent = fs.readFileSync(taskFilePath).toString();
    try {
        const previousTasks = JSON.parse(taskFileContent);
        const index = previousTasks.findIndex(t => {
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
    const taskFilePath = path.resolve(__dirname, '../../tasks.json');
    const tasks = [];
    if (fs.existsSync(taskFilePath)) {
        const taskFileContent = fs.readFileSync(taskFilePath).toString();
        try {
            const previousTasks = JSON.parse(taskFileContent);
            tasks.push(...previousTasks);
        } catch (e) {
            throw new Error('Fail to parse previous tasks, ignored. ' + e);
        }
    }

    const index = tasks.findIndex(t => t.id === task.id);
    
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
    const taskFilePath = path.resolve(__dirname, '../../tasks.json');
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
        throw new Error('Fail to parse previous tasks, ignored. ' + e);
    }

    const index = tasks.findIndex(t => t.id === taskId);
    
    if (index !== -1) {
        return false;
    } else {
        // Write back to file
        fs.writeFileSync(taskFilePath, JSON.stringify(
            tasks.filter(t => t.id !== taskId),
            null,
            2
        ));
    }
}