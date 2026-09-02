import * as fs from "fs";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { IsoBmffSampleAesHandler } from "@/core/download/encryption/sample_aes/iso_bmff/handler";
import { Mp4DecryptRunner, Mp4DecryptRunResult } from "@/core/download/encryption/sample_aes/iso_bmff/runner";
import { FatalDecryptionError } from "@/core/download/encryption/types";
import { runWithAbortSignal } from "@/utils/abort";
import { withTempDirectory } from "../../../helpers/filesystem";
import {
    createClearInitialization,
    createMediaFragment,
    createProtectedInitialization,
} from "../../../helpers/isobmff";

class CopyingRunner implements Mp4DecryptRunner {
    readonly calls: readonly string[][] = [];
    fragmentsInfo?: Buffer;

    constructor(
        private readonly clearInitialization: Buffer,
        private readonly fail = false,
    ) {}

    async run(arguments_: readonly string[]): Promise<Mp4DecryptRunResult> {
        (this.calls as string[][]).push([...arguments_]);
        if (this.fail) {
            throw new Error("ERROR: fixture failure");
        }
        const inputPath = arguments_[arguments_.length - 2];
        const outputPath = arguments_[arguments_.length - 1];
        const fragmentsInfoIndex = arguments_.indexOf("--fragments-info");
        if (fragmentsInfoIndex >= 0) {
            this.fragmentsInfo = fs.readFileSync(arguments_[fragmentsInfoIndex + 1]);
        }
        fs.writeFileSync(outputPath, fragmentsInfoIndex >= 0 ? fs.readFileSync(inputPath) : this.clearInitialization);
        return { stderr: "" };
    }
}

const key = "11".repeat(16);
const initializationEncryption = {
    scheme: "iso-bmff-sample-aes" as const,
    operation: "initialization" as const,
    keys: [{ selector: "1", keyId: "fixture:key" }],
};

describe("IsoBmffSampleAesHandler", () => {
    test("decrypts init and media separately with fragments-info", async () => {
        await withTempDirectory("minyami-fmp4-handler-", async (directory) => {
            const encryptedInitialization = path.join(directory, "encrypted-init.mp4");
            const clearInitialization = path.join(directory, "clear-init.mp4");
            const encryptedFragment = path.join(directory, "encrypted.m4s");
            const clearFragment = path.join(directory, "clear.m4s");
            fs.writeFileSync(encryptedInitialization, createProtectedInitialization());
            fs.writeFileSync(encryptedFragment, createMediaFragment("fragment"));
            const runner = new CopyingRunner(createClearInitialization());
            const handler = new IsoBmffSampleAesHandler(runner);
            const signal = new AbortController().signal;
            const keys = new Map([["fixture:key", key]]);
            const protectedInitialization = createProtectedInitialization();
            const fragmentEncryption = {
                scheme: "iso-bmff-sample-aes" as const,
                operation: "fragment" as const,
                keys: initializationEncryption.keys,
                fragmentsInfoBase64: protectedInitialization.toString("base64"),
            };

            await runWithAbortSignal(signal, () =>
                handler.decrypt({
                    inputPath: encryptedInitialization,
                    outputPath: clearInitialization,
                    encryption: initializationEncryption,
                    keys,
                }),
            );
            await runWithAbortSignal(signal, () =>
                handler.decrypt({
                    inputPath: encryptedFragment,
                    outputPath: clearFragment,
                    encryption: fragmentEncryption,
                    keys,
                }),
            );

            expect(runner.calls[0].slice(0, 2)).toEqual(["--key", `1:${key}`]);
            expect(runner.calls[1]).toContain("--fragments-info");
            expect(runner.fragmentsInfo).toEqual(protectedInitialization);
            expect(fs.readFileSync(clearInitialization)).toEqual(createClearInitialization());
            expect(fs.readFileSync(clearFragment)).toEqual(createMediaFragment("fragment"));
        });
    });

    test("removes partial output and reports tool failures as fatal", async () => {
        await withTempDirectory("minyami-fmp4-handler-error-", async (directory) => {
            const inputPath = path.join(directory, "encrypted-init.mp4");
            const outputPath = path.join(directory, "clear-init.mp4");
            fs.writeFileSync(inputPath, createProtectedInitialization());
            const handler = new IsoBmffSampleAesHandler(new CopyingRunner(createClearInitialization(), true));

            await expect(
                runWithAbortSignal(new AbortController().signal, () =>
                    handler.decrypt({
                        inputPath,
                        outputPath,
                        encryption: initializationEncryption,
                        keys: new Map([["fixture:key", key]]),
                    }),
                ),
            ).rejects.toBeInstanceOf(FatalDecryptionError);
            expect(fs.existsSync(inputPath)).toBe(true);
            expect(fs.existsSync(outputPath)).toBe(false);
        });
    });
});
