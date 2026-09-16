import type { ArgumentValue } from "erii";
import type { CliOptions } from "./arguments";

/** Use canonical CLI spellings so Erii can also infer its camel-case proxy properties. */
export interface MinyamiCliSchema {
    commonOptions: Pick<CliOptions, "verbose">;
    commands: {
        help: { aliases: "h"; argument?: string };
        version: {};
        download: {
            aliases: "d";
            argument: ArgumentValue;
            options: Pick<
                CliOptions,
                "threads" | "retries" | "output" | "cookies" | "headers" | "proxy" | "keep" | "key" | "live" | "slice"
            > & {
                "temp-dir"?: CliOptions["tempDir"];
                "no-proxy"?: CliOptions["noProxy"];
                "no-merge"?: CliOptions["noMerge"];
                "keep-encrypted-chunks"?: CliOptions["keepEncryptedChunks"];
            };
        };
    };
}
