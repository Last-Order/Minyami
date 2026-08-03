import { DownloadTask, DownloadTaskGroupAction, DownloadTaskItem } from "../downloader";
import { M3U8Chunk, Playlist } from "../m3u8";
import { ChunkNamer } from "../download/chunk_naming";
import { DownloadHttpClient } from "../download/http_client";

export type ParserMode = "archive" | "live";

export interface ParserOptions {
    mode: ParserMode;
    m3u8Path: string;
    playlist: Playlist;
    key?: string;
    threads: number;
    retries: number;
    http: DownloadHttpClient;
    currentTasks?: DownloadTaskItem[];
}

export interface KeyResolverOptions {
    keyUrls: string[];
    explicitKeys: string[];
    playlistUrl: string;
}

export type KeyResolver = (options: KeyResolverOptions) => Promise<Record<string, string>>;

export interface ParserLifecycle {
    onParsed?: () => Promise<void> | void;
    onDownloaded?: () => Promise<void> | void;
    onFinished?: () => Promise<void> | void;
    onCriticalError?: () => Promise<void> | void;
}

export interface ParserResult {
    tasks?: DownloadTaskItem[];
    autoGenerateTasks?: boolean;
    chunks?: M3U8Chunk[];
    encryptionKeys?: Record<string, string>;
    keyResolver?: KeyResolver;
    chunkNamer?: ChunkNamer;
    dropChunksOnMaxRetries?: boolean;
    prepareTask?: (task: DownloadTask) => DownloadTask;
    prepareAction?: (action: DownloadTaskGroupAction) => DownloadTaskGroupAction;
    lifecycle?: ParserLifecycle;
}

export function mergeParserResults(...results: ParserResult[]): ParserResult {
    const defined = results.filter(Boolean);
    const lifecycles = defined.map((result) => result.lifecycle).filter(Boolean);
    const callLifecycle = (name: keyof ParserLifecycle) => async () => {
        for (const lifecycle of lifecycles) {
            await lifecycle[name]?.();
        }
    };

    return {
        ...defined.reduce((combined, result) => ({ ...combined, ...result }), {}),
        encryptionKeys: Object.assign({}, ...defined.map((result) => result.encryptionKeys || {})),
        ...(lifecycles.length > 0
            ? {
                  lifecycle: {
                      onParsed: callLifecycle("onParsed"),
                      onDownloaded: callLifecycle("onDownloaded"),
                      onFinished: callLifecycle("onFinished"),
                      onCriticalError: callLifecycle("onCriticalError"),
                  },
              }
            : {}),
    };
}
