import logger from "../../../utils/log";
import { adaptAbema } from "./adapters/abema";
import { adaptCommon } from "./adapters/common";
import { adaptHibiki } from "./adapters/hibiki";
import { SiteAdapterOptions, SiteAdapterResult } from "./adapters/types";
import { adaptYoutube } from "./adapters/youtube";

export async function prepareSite(options: SiteAdapterOptions): Promise<SiteAdapterResult> {
    const { playlist, sourcePath, mode } = options;

    if (playlist.encryptKeys.length > 0) {
        const firstKey = playlist.encryptKeys[0];
        if (firstKey.startsWith("abematv-license")) {
            logger.info("Site confirmed: AbemaTV.");
            return adaptAbema(options);
        }
        if (mode === "archive" && sourcePath.includes("d22puzix29w08m")) {
            logger.info("Site confirmed: Hibiki-Radio.");
            return adaptHibiki(options);
        }
        logger.warning("Site is not supported by Minyami Core. Use the common HLS adapter.");
        return adaptCommon(options);
    }

    if (sourcePath.includes("googlevideo")) {
        logger.info("Site confirmed: YouTube.");
        return adaptYoutube(options);
    }

    if (mode === "archive" && sourcePath.includes("bcovlive")) {
        logger.info("Site confirmed: Stagecrowd.");
        return adaptCommon(options);
    }

    logger.warning("Site is not supported by Minyami Core. Use the common HLS adapter.");
    return adaptCommon(options);
}
