import { abemaAdapter } from "./abema";
import { SiteAdapter } from "./types";

/** Adapter order is precedence order; at most one site-specific plan is applied. */
export const siteAdapters: readonly SiteAdapter[] = [abemaAdapter];
