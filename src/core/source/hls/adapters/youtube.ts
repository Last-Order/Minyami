import { SiteAdapterOptions, SiteAdapterResult } from "./types";

export function adaptYoutube(_options: SiteAdapterOptions): SiteAdapterResult {
    return {
        itemNamer: (item) => {
            const match = item.url.match(/\/(\d+?)\/goap/);
            if (!match) {
                throw new Error(`Bad item url: ${item.url}`);
            }
            return match[1];
        },
    };
}
