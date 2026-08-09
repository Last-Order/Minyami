import { DownloadHttpClient } from "../../../download/http_client";
import { DownloadItemNamer } from "../../types";
import { HLSMediaPlaylist, HLSSegment } from "../parser";

export type SiteAdapterMode = "archive" | "live";

export interface SiteAdapterOptions {
    mode: SiteAdapterMode;
    sourcePath: string;
    playlist: HLSMediaPlaylist;
    key?: string;
    retries: number;
    http: DownloadHttpClient;
}

export interface KeyResolverOptions {
    keyUrls: readonly string[];
    explicitKeys: readonly string[];
}

export type KeyResolver = (options: KeyResolverOptions) => Promise<Record<string, string>>;

export interface SiteAdapterResult {
    segments?: readonly HLSSegment[];
    encryptionKeys?: Record<string, string>;
    keyResolver?: KeyResolver;
    itemNamer?: DownloadItemNamer;
}
