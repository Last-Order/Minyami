import { adaptCommon } from "./adapters/common";
import { siteAdapters } from "./adapters/registry";
import { SiteAdapterOptions, SiteAdapterResult } from "./adapters/types";

export async function prepareSite(options: SiteAdapterOptions): Promise<SiteAdapterResult> {
    const commonResult = await adaptCommon(options);
    const adapter = siteAdapters.find((candidate) => candidate.matches(options));
    return adapter ? { ...commonResult, ...(await adapter.prepare(options)) } : commonResult;
}
