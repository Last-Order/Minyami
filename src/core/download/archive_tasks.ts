import { DownloadTask, DownloadTaskItem, isTaskGroup } from "../downloader";
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

export function cloneTaskItems(items: DownloadTaskItem[]): DownloadTaskItem[] {
    return items.map((item) =>
        isTaskGroup(item)
            ? {
                  ...item,
                  subTasks: item.subTasks.map((task) => ({ ...task, chunk: { ...task.chunk } })),
                  actions: item.actions?.map((action) => ({ ...action })),
              }
            : { ...item, chunk: { ...item.chunk } }
    );
}

export function countTasks(items: DownloadTaskItem[]): number {
    return items.reduce((count, item) => count + (isTaskGroup(item) ? item.subTasks.length : 1), 0);
}

export function forEachTask(items: DownloadTaskItem[], visitor: (task: DownloadTask) => void): void {
    for (const item of items) {
        if (isTaskGroup(item)) {
            item.subTasks.forEach(visitor);
        } else {
            visitor(item);
        }
    }
}

export function sliceArchiveTasks(
    items: DownloadTaskItem[],
    sliceStart?: number,
    sliceEnd?: number
): DownloadTaskItem[] {
    if (sliceStart === undefined || sliceEnd === undefined) {
        return items;
    }

    const selected: DownloadTaskItem[] = [];
    let currentTime = 0;
    for (const item of items) {
        if (currentTime >= sliceEnd) {
            break;
        }
        if (isTaskGroup(item)) {
            const subTasks = item.subTasks.filter((task) => {
                if (isInitialChunk(task.chunk)) {
                    return true;
                }
                const taskStart = currentTime;
                const taskEnd = currentTime + task.chunk.length;
                currentTime = taskEnd;
                return taskEnd >= sliceStart && taskStart < sliceEnd;
            });
            if (subTasks.length > 0) {
                selected.push({ ...item, subTasks, isFinished: false, isNew: true });
            }
            continue;
        }
        if (isInitialChunk(item.chunk)) {
            selected.push(item);
            continue;
        }
        const taskStart = currentTime;
        const taskEnd = currentTime + item.chunk.length;
        currentTime = taskEnd;
        if (taskEnd >= sliceStart && taskStart < sliceEnd) {
            selected.push(item);
        }
    }

    const first = selected[0];
    if (first && !isTaskGroup(first) && isInitialChunk(first.chunk)) {
        let id = 0;
        forEachTask(selected, (task) => {
            task.id = id++;
        });
    }
    return selected;
}
