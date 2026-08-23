import { randomUUID } from "crypto";
import * as fs from "fs";
import {
    inspectIsoBmffInitialization,
    validateClearIsoBmffFragment,
    validateClearIsoBmffInitialization,
} from "../../../isobmff";
import { DownloadEncryption } from "../../../source/types";
import { DecryptionRequest, EncryptionHandler, FatalDecryptionError } from "../types";
import { Mp4DecryptRunner, SystemMp4DecryptRunner } from "./runner";

const AES_128_KEY = /^[0-9a-fA-F]{32}$/;
const KEY_SELECTOR = /^(?:[1-9][0-9]*|[0-9a-fA-F]{32})$/;

export class IsoBmffSampleAesHandler implements EncryptionHandler {
    readonly scheme = "iso-bmff-sample-aes" as const;
    private readonly fragmentsInfo = new Map<string, Buffer>();

    constructor(private readonly runner: Mp4DecryptRunner = new SystemMp4DecryptRunner()) {}

    keyIds(encryption: DownloadEncryption): readonly string[] {
        this.requireDescriptor(encryption);
        return [...new Set(encryption.keys.map((key) => key.keyId))];
    }

    validate(encryption: DownloadEncryption, keys: ReadonlyMap<string, string>): void {
        this.requireDescriptor(encryption);
        if (encryption.keys.length === 0) {
            throw new Error("fMP4 SAMPLE-AES requires at least one decryption key.");
        }
        const selectors = new Set<string>();
        for (const reference of encryption.keys) {
            if (!KEY_SELECTOR.test(reference.selector)) {
                throw new Error(`Invalid mp4decrypt key selector: ${reference.selector}`);
            }
            if (selectors.has(reference.selector.toLowerCase())) {
                throw new Error(`Duplicate mp4decrypt key selector: ${reference.selector}`);
            }
            selectors.add(reference.selector.toLowerCase());
            const key = keys.get(reference.keyId);
            if (!key) {
                throw new Error(`Missing encryption key for ${reference.keyId}`);
            }
            if (!AES_128_KEY.test(key)) {
                throw new Error("SAMPLE-AES key must contain exactly 16 bytes of hexadecimal data.");
            }
        }
        if (encryption.operation === "fragment") {
            this.requireFragmentsInfo(encryption.fragmentsInfoBase64);
        }
    }

    async decrypt(request: DecryptionRequest): Promise<void> {
        const { inputPath, outputPath, encryption, keys, signal } = request;
        this.validate(encryption, keys);
        this.requireDescriptor(encryption);

        const operationId = `${process.pid}-${randomUUID()}`;
        const temporaryOutputPath = `${outputPath}.t-${operationId}`;
        const fragmentsInfoPath =
            encryption.operation === "fragment" ? `${outputPath}.fragments-info-${operationId}` : undefined;
        const keyArguments = encryption.keys.flatMap((reference) => [
            "--key",
            `${reference.selector}:${keys.get(reference.keyId)!}`,
        ]);
        const arguments_ = [
            ...keyArguments,
            ...(fragmentsInfoPath ? ["--fragments-info", fragmentsInfoPath] : []),
            inputPath,
            temporaryOutputPath,
        ];
        try {
            if (fragmentsInfoPath && encryption.operation === "fragment") {
                await fs.promises.writeFile(
                    fragmentsInfoPath,
                    this.requireFragmentsInfo(encryption.fragmentsInfoBase64),
                    { flag: "wx" }
                );
            }
            await this.runner.run(arguments_, signal);
            const output = await fs.promises.readFile(temporaryOutputPath);
            if (output.length === 0) {
                throw new Error("mp4decrypt created an empty output file.");
            }
            if (encryption.operation === "initialization") {
                validateClearIsoBmffInitialization(output);
            } else {
                validateClearIsoBmffFragment(output);
            }
            await fs.promises.rename(temporaryOutputPath, outputPath);
        } catch (error) {
            await fs.promises.rm(temporaryOutputPath, { force: true }).catch(() => undefined);
            if (signal.aborted) {
                throw error;
            }
            throw new FatalDecryptionError(describeError(error), { cause: error });
        } finally {
            if (fragmentsInfoPath) {
                await fs.promises.rm(fragmentsInfoPath, { force: true }).catch(() => undefined);
            }
        }
    }

    private requireFragmentsInfo(encoded: string): Buffer {
        const cached = this.fragmentsInfo.get(encoded);
        if (cached) {
            return cached;
        }
        const initialization = Buffer.from(encoded, "base64");
        if (initialization.length === 0 || initialization.toString("base64") !== encoded) {
            throw new Error("Invalid base64-encoded fragments-info initialization segment.");
        }
        const info = inspectIsoBmffInitialization(initialization);
        if (info.protectedTrackIds.length === 0 || info.protectionSchemes.some((scheme) => scheme !== "cbcs")) {
            throw new Error("fMP4 SAMPLE-AES fragments-info must contain protected cbcs sample entries.");
        }
        this.fragmentsInfo.set(encoded, initialization);
        return initialization;
    }

    private requireDescriptor(
        encryption: DownloadEncryption
    ): asserts encryption is Extract<DownloadEncryption, { scheme: "iso-bmff-sample-aes" }> {
        if (encryption.scheme !== this.scheme) {
            throw new Error(`Invalid encryption descriptor for ${this.scheme}`);
        }
    }
}

function describeError(error: unknown): string {
    return error instanceof Error && error.message ? error.message : String(error) || "mp4decrypt failed.";
}
