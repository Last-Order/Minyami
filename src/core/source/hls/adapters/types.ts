import { DownloadSourceHttpClient } from "../../types";
import { HLSExplicitKey } from "../explicit_key";
import { HLSKeyReference, HLSMediaPlaylist, HLSSegment } from "../parser";

export interface SiteAdapterOptions {
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
    keyResolver?: KeyResolver;
    adaptSegments?: (segments: readonly HLSSegment[]) => readonly HLSSegment[];
}

export interface SiteAdapter {
    matches(options: SiteAdapterOptions): boolean;
    prepare(options: SiteAdapterOptions): SiteAdapterResult | Promise<SiteAdapterResult>;
}
