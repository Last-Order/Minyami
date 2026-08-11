import { DownloadItemNamer, DownloadSourceHttpClient } from "../../types";
import { HLSMediaPlaylist, HLSSegment } from "../parser";

export type SiteAdapterMode = "archive" | "live";

export interface SiteAdapterOptions {
    mode: SiteAdapterMode;
    sourcePath: string;
    playlist: HLSMediaPlaylist;
    explicitKeys: readonly string[];
    http: DownloadSourceHttpClient;
}

export interface KeyResolverOptions {
    keyUrls: readonly string[];
    signal: AbortSignal;
}

export type KeyResolver = (options: KeyResolverOptions) => Promise<Record<string, string>>;

export interface SiteAdapterResult {
    segments?: readonly HLSSegment[];
    encryptionKeys?: Record<string, string>;
    keyResolver?: KeyResolver;
    itemNamer?: DownloadItemNamer;
}
