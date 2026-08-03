import { getFileExt } from "../../utils/common";
import { M3U8Chunk } from "../m3u8";
import { NamingStrategy } from "../types";

export type ChunkNamer = (chunk: M3U8Chunk, id: number) => string;

export function createChunkNamer(strategy: NamingStrategy): ChunkNamer {
    return (chunk, id) => {
        if (strategy === NamingStrategy.MIXED) {
            return `${id.toString().padStart(6, "0")}_${new URL(chunk.url).pathname
                .split("/")
                .slice(-1)[0]
                .slice(17 - 255)}`;
        }
        if (strategy === NamingStrategy.USE_FILE_SEQUENCE) {
            const ext = getFileExt(chunk.url);
            return `${id.toString().padStart(6, "0")}${ext ? `.${ext}` : ""}`;
        }
        return new URL(chunk.url).pathname
            .split("/")
            .slice(-1)[0]
            .slice(10 - 255);
    };
}
