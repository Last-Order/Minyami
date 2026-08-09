import { DownloadHttpClient } from "../../../download/http_client";
import { DownloadItemNamer } from "../../types";
import { HLSChunk, MediaPlaylist } from "../parser";

export type SiteAdapterMode = "archive" | "live";

export interface SiteAdapterOptions {
    mode: SiteAdapterMode;
    sourcePath: string;
    playlist: MediaPlaylist;
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

export interface SiteAdapterResult {
    chunks?: HLSChunk[];
    encryptionKeys?: Record<string, string>;
    keyResolver?: KeyResolver;
    itemNamer?: DownloadItemNamer;
}
