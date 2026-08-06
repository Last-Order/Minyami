import { DownloadItemNamer } from "../source/types";

/**
 * Discovery ids keep repeated upstream basenames unique and sortable; retaining
 * the basename makes kept items recognizable without exposing a naming policy.
 */
export const mixedItemNamer: DownloadItemNamer = (item, id) =>
    `${id.toString().padStart(6, "0")}_${new URL(item.url).pathname
        .split("/")
        .slice(-1)[0]
        .slice(17 - 255)}`;
