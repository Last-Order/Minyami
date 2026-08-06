import logger from "../../../utils/log";
import { parseAbema } from "../../parsers/abema";
import { parseCommon } from "../../parsers/common";
import { parseHibiki } from "../../parsers/hibiki";
import { ParserOptions, ParserResult } from "../../parsers/types";
import { parseYoutube } from "../../parsers/youtube";

export async function prepareSite(options: ParserOptions): Promise<ParserResult> {
    const { playlist, m3u8Path, mode } = options;

    if (playlist.encryptKeys.length > 0) {
        const firstKey = playlist.encryptKeys[0];
        if (firstKey.startsWith("abematv-license")) {
            logger.info("Site confirmed: AbemaTV.");
            return parseAbema(options);
        }
        if (mode === "archive" && m3u8Path.includes("d22puzix29w08m")) {
            logger.info("Site confirmed: Hibiki-Radio.");
            return parseHibiki(options);
        }
        logger.warning("Site is not supported by Minyami Core. Try common parser.");
        return parseCommon(options);
    }

    if (m3u8Path.includes("googlevideo")) {
        logger.info("Site confirmed: YouTube.");
        return parseYoutube(options);
    }

    if (mode === "archive" && m3u8Path.includes("bcovlive")) {
        logger.info("Site confirmed: Stagecrowd.");
        return parseCommon(options);
    }

    logger.warning("Site is not supported by Minyami Core. Try common parser.");
    return parseCommon(options);
}
