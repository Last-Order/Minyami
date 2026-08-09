import prompts from "prompts";
import logger from "../../../utils/log";
import { HLSVariant } from "./models";

export type HLSVariantSelector = (
    variants: readonly HLSVariant[]
) => HLSVariant | undefined | Promise<HLSVariant | undefined>;

interface HLSVariantChoice {
    readonly title: string;
    readonly description: string;
    readonly value: HLSVariant;
}

/**
 * The default selector keeps automated consumers non-blocking while giving an
 * attached terminal an explicit choice of HLS rendition.
 */
export async function selectHLSVariantInteractively(variants: readonly HLSVariant[]): Promise<HLSVariant | undefined> {
    const choices = createHLSVariantChoices(variants);
    const bestVariant = choices[0].value;

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        logger.warning("Interactive stream selection is unavailable. Selecting the highest-bandwidth stream.");
        return bestVariant;
    }

    const response = await prompts({
        type: "select",
        name: "variant",
        message: "Select an HLS stream",
        choices,
        initial: 0,
    });
    return response.variant as HLSVariant | undefined;
}

function createHLSVariantChoices(variants: readonly HLSVariant[]): HLSVariantChoice[] {
    return [...variants]
        .sort((a, b) => b.bandwidth - a.bandwidth)
        .map((variant) => ({
            title: formatHLSVariant(variant),
            description: variant.url,
            value: variant,
        }));
}

function formatHLSVariant(variant: HLSVariant): string {
    const resolution = variant.resolution
        ? `${variant.resolution.width}x${variant.resolution.height}`
        : "unknown resolution";
    const details = [resolution, formatBandwidth(variant.bandwidth)];
    if (variant.frameRate !== undefined) {
        details.push(`${variant.frameRate} fps`);
    }
    if (variant.codecs) {
        details.push(variant.codecs);
    }
    return details.join(" | ");
}

function formatBandwidth(bandwidth: number): string {
    return `${(bandwidth / 1_000_000).toFixed(2)} Mbps`;
}
