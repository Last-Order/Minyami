import { DownloadTask } from "../downloader";
import { isInitialChunk, Playlist } from "../m3u8";
import { ChunkNamer } from "./chunk_naming";

export function createArchiveTasks(playlist: Playlist, nameChunk: ChunkNamer): DownloadTask[] {
    return playlist.chunks.map((chunk, index) => ({
        filename: nameChunk(chunk, index),
        retryCount: 0,
        chunk,
        id: index,
    }));
}

export function cloneTasks(tasks: DownloadTask[]): DownloadTask[] {
    return tasks.map((task) => ({ ...task, chunk: { ...task.chunk } }));
}

export function sliceArchiveTasks(tasks: DownloadTask[], sliceStart?: number, sliceEnd?: number): DownloadTask[] {
    if (sliceStart === undefined || sliceEnd === undefined) {
        return tasks;
    }

    const selected: DownloadTask[] = [];
    let currentTime = 0;
    for (const task of tasks) {
        if (currentTime >= sliceEnd) {
            break;
        }
        if (isInitialChunk(task.chunk)) {
            selected.push(task);
            continue;
        }
        const taskStart = currentTime;
        const taskEnd = currentTime + task.chunk.length;
        currentTime = taskEnd;
        if (taskEnd >= sliceStart && taskStart < sliceEnd) {
            selected.push(task);
        }
    }

    const first = selected[0];
    if (first && isInitialChunk(first.chunk)) {
        selected.forEach((task, id) => {
            task.id = id;
        });
    }
    return selected;
}
