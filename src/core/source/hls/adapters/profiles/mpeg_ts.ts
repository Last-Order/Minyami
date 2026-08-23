import { MPEG_TS_CONTAINER } from "../../../../media_container";
import { prepareSingleFileKeys, toSingleFileDownloadItem } from "./single_file";
import { HLSProfileAdapter } from "./types";

// Keep the established plan id for compatibility; the file and symbol use the precise container name.
const PROFILE_ID = "standard";

export const mpegTsHLSProfile: HLSProfileAdapter = {
    id: PROFILE_ID,
    prepare: (options) => ({
        id: PROFILE_ID,
        container: MPEG_TS_CONTAINER,
        ensureKeys: prepareSingleFileKeys(
            options,
            "The standard HLS profile accepts at most one explicit decryption key."
        ),
        toDownloadItem: (segment) =>
            toSingleFileDownloadItem(
                segment,
                "mpeg-ts-sample-aes",
                "An explicit IV is required for MPEG-TS SAMPLE-AES HLS."
            ),
    }),
};
