import { M3U8Chunk } from "../m3u8";

export type ChunkNamer = (chunk: M3U8Chunk, id: number) => string;

/**
 * Discovery ids keep repeated upstream basenames unique and sortable; retaining
 * the basename makes kept chunks recognizable without exposing a naming policy.
 */
export const mixedChunkNamer: ChunkNamer = (chunk, id) =>
    `${id.toString().padStart(6, "0")}_${new URL(chunk.url).pathname
        .split("/")
        .slice(-1)[0]
        .slice(17 - 255)}`;
