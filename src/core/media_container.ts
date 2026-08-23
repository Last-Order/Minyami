import * as path from "path";

export interface MediaContainer {
    readonly name: string;
    /** Lowercase filename extension without a leading dot. */
    readonly extension: string;
}

export const MPEG_TS_CONTAINER = Object.freeze<MediaContainer>({ name: "MPEG-TS", extension: "ts" });
export const AAC_CONTAINER = Object.freeze<MediaContainer>({ name: "AAC", extension: "aac" });
export const MATROSKA_CONTAINER = Object.freeze<MediaContainer>({ name: "Matroska", extension: "mkv" });
export const MP4_CONTAINER = Object.freeze<MediaContainer>({ name: "MP4", extension: "mp4" });

const COMMON_VIDEO_EXTENSIONS = new Set([
    "3g2",
    "3gp",
    "asf",
    "avi",
    "flv",
    "m2ts",
    "m4v",
    "mkv",
    "mov",
    "mp4",
    "mpe",
    "mpeg",
    "mpg",
    "mts",
    "ogv",
    "rm",
    "rmvb",
    "ts",
    "vob",
    "webm",
    "wmv",
]);

/**
 * Treat the configured output as a basename. Only known video suffixes are
 * removed so meaningful dots in names and unknown suffixes remain intact.
 */
export function normalizeOutputBasePath(outputPath = "./output"): string {
    const parsed = path.parse(outputPath);
    const extension = parsed.ext.slice(1).toLowerCase();
    return COMMON_VIDEO_EXTENSIONS.has(extension) ? path.join(parsed.dir, parsed.name) : outputPath;
}

export function createContainerOutputPath(outputBasePath: string, container: MediaContainer, trackId?: string): string {
    if (!/^[a-z0-9]{1,10}$/.test(container.extension)) {
        throw new Error(`Invalid media container extension: ${container.extension}`);
    }
    return `${outputBasePath}${trackId ? `.${trackId}` : ""}.${container.extension}`;
}
