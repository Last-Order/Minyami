import { DownloadItemNamer, DownloadSourceHttpClient } from "../../types";
import { HLSExplicitKey } from "../explicit_key";
import { HLSKeyReference, HLSMediaPlaylist, HLSSegment } from "../parser";

export type SiteAdapterMode = "archive" | "live";

export interface SiteAdapterOptions {
    mode: SiteAdapterMode;
    sourcePath: string;
    playlist: HLSMediaPlaylist;
    explicitKeys: readonly HLSExplicitKey[];
    http: DownloadSourceHttpClient;
}

export interface KeyResolverOptions {
    keys: readonly HLSKeyReference[];
    signal: AbortSignal;
}

export type KeyResolver = (options: KeyResolverOptions) => Promise<Record<string, string>>;

export interface SiteAdapterResult {
    segments?: readonly HLSSegment[];
    encryptionKeys?: Record<string, string>;
    keyResolver?: KeyResolver;
    itemNamer?: DownloadItemNamer;
}
