import { AAC_CONTAINER } from "@/core/media_container";
import { prepareSingleFileKeys, toSingleFileDownloadItem } from "./single_file";
import { HLSProfileAdapter } from "./types";

const PROFILE_ID = "packed-aac";

export const packedAacHLSProfile: HLSProfileAdapter = {
    id: PROFILE_ID,
    prepare: (options) => ({
        id: PROFILE_ID,
        container: AAC_CONTAINER,
        ensureKeys: prepareSingleFileKeys(
            options,
            "The packed-AAC HLS profile accepts at most one explicit decryption key."
        ),
        toDownloadItem: (segment) =>
            toSingleFileDownloadItem(
                segment,
                "packed-aac-sample-aes",
                "An explicit IV is required for Packed AAC SAMPLE-AES HLS."
            ),
    }),
};
