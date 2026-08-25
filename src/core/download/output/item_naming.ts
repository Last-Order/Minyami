import { DownloadItemNamer } from "@/core/source/types";

/**
 * Track-local indices keep repeated upstream basenames unique and sortable inside
 * an isolated track directory; the basename keeps retained items recognizable.
 */
export const mixedItemNamer: DownloadItemNamer = (item, id) =>
    `${id.trackIndex.toString().padStart(6, "0")}_${new URL(item.url).pathname
        .split("/")
        .slice(-1)[0]
        .slice(17 - 255)}`;
