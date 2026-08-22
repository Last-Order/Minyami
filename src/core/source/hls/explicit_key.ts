export interface HLSExplicitKey {
    readonly kid?: string;
    readonly key: string;
}

/** Converts the CLI's compact key syntax before it enters the HLS source model. */
export function parseHLSExplicitKey(input: string): HLSExplicitKey {
    const separatorIndex = input.indexOf(":");
    if (separatorIndex === -1) {
        return { key: input };
    }
    return {
        kid: input.slice(0, separatorIndex),
        key: input.slice(separatorIndex + 1),
    };
}

/** Preserves the one-option-to-one-key CLI boundary when an option is repeated. */
export function parseHLSExplicitKeyInputs(inputs: string | readonly string[]): readonly HLSExplicitKey[] {
    return (typeof inputs === "string" ? [inputs] : inputs).map(parseHLSExplicitKey);
}
