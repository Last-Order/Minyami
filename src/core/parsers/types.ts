import { M3U8Chunk, Playlist } from "../m3u8";
import { DownloadHttpClient } from "../download/http_client";
import { DownloadItemNamer } from "../source/types";

export type ParserMode = "archive" | "live";

export interface ParserOptions {
    mode: ParserMode;
    m3u8Path: string;
    playlist: Playlist;
    key?: string;
    retries: number;
    http: DownloadHttpClient;
}

export interface KeyResolverOptions {
    keyUrls: string[];
    explicitKeys: string[];
    playlistUrl: string;
}

export type KeyResolver = (options: KeyResolverOptions) => Promise<Record<string, string>>;

export interface ParserResult {
    chunks?: M3U8Chunk[];
    encryptionKeys?: Record<string, string>;
    keyResolver?: KeyResolver;
    itemNamer?: DownloadItemNamer;
}
