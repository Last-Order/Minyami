import { AAC_CONTAINER } from "../../../../media_container";
import { HLSSegmentKind } from "../../parser";
import { prepareSingleFileKeys, toSingleFileDownloadItem } from "./single_file";
import { HLSProfileAdapter } from "./types";

const PROFILE_ID = "packed-aac";

export const packedAacHLSProfile: HLSProfileAdapter = {
    id: PROFILE_ID,
    matches: (playlist, format) =>
        format === "packed-aac" &&
        !playlist.segments.some((segment) => segment.kind === HLSSegmentKind.Initialization) &&
        playlist.segments.every(
            (segment) =>
                segment.encryption === undefined ||
                segment.encryption.method === "AES-128" ||
                segment.encryption.method === "SAMPLE-AES"
        ),
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
