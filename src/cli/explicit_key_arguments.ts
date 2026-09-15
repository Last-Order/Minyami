import { HLSExplicitKey } from "@/core/source/hls/types";

/** Parses the compact value accepted by one --key occurrence. */
export function parseExplicitKeyArgument(input: string): HLSExplicitKey {
    const separatorIndex = input.indexOf(":");
    if (separatorIndex === -1) {
        return { key: input };
    }
    return {
        kid: input.slice(0, separatorIndex),
        key: input.slice(separatorIndex + 1),
    };
}

/** Preserves one CLI option occurrence as one explicit key. */
export function parseExplicitKeyArguments(inputs: string | readonly string[]): readonly HLSExplicitKey[] {
    return (typeof inputs === "string" ? [inputs] : inputs).map(parseExplicitKeyArgument);
}
