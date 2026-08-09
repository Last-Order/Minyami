import { afterEach, describe, expect, jest, test } from "@jest/globals";
import prompts from "prompts";
import logger from "../../../../src/utils/log";
import { HLSVariant } from "../../../../src/core/source/hls/parser";
import { selectHLSVariantInteractively } from "../../../../src/core/source/hls/variant_selector";

jest.mock("prompts");

const promptMock = jest.mocked(prompts);

const variants: readonly HLSVariant[] = [
    {
        url: "https://media.example/low.m3u8",
        bandwidth: 800000,
    },
    {
        url: "https://media.example/high.m3u8",
        bandwidth: 2400000,
        resolution: { width: 1920, height: 1080 },
        frameRate: 59.94,
        codecs: "avc1.640028,mp4a.40.2",
    },
];

afterEach(() => {
    delete (process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY;
    delete (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
});

describe("HLS variant selector", () => {
    test("sorts and formats menu choices without changing the source order", async () => {
        setTTY(true);
        promptMock.mockResolvedValue({ variant: variants[0] });

        await expect(selectHLSVariantInteractively(variants)).resolves.toBe(variants[0]);

        const prompt = promptMock.mock.calls[0][0] as {
            initial: number;
            choices: Array<{ title: string; value: HLSVariant }>;
        };
        expect(prompt.initial).toBe(0);
        expect(prompt.choices.map((choice) => choice.value)).toEqual([variants[1], variants[0]]);
        expect(variants.map((variant) => variant.bandwidth)).toEqual([800000, 2400000]);
        expect(prompt.choices[0]).toEqual({
            title: "1920x1080 | 2.40 Mbps | 59.94 fps | avc1.640028,mp4a.40.2",
            value: variants[1],
        });
        expect(prompt.choices[1]).toEqual({
            title: "unknown resolution | 0.80 Mbps",
            value: variants[0],
        });
    });

    test("falls back to the highest-bandwidth stream outside a TTY", async () => {
        setTTY(false);
        const warning = jest.spyOn(logger, "warning").mockImplementation(() => undefined);

        await expect(selectHLSVariantInteractively(variants)).resolves.toBe(variants[1]);

        expect(warning).toHaveBeenCalledWith(
            "Interactive stream selection is unavailable. Selecting the highest-bandwidth stream."
        );
    });

    test("returns undefined when the interactive prompt is cancelled", async () => {
        setTTY(true);
        promptMock.mockResolvedValue({});

        await expect(selectHLSVariantInteractively(variants)).resolves.toBeUndefined();
    });
});

function setTTY(isTTY: boolean): void {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: isTTY });
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: isTTY });
}
