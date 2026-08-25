import * as fs from "fs";
import { randomUUID } from "crypto";
import { DownloadEncryption, MpegTsSampleAesEncryption } from "../../../source/types";
import { DecryptionRequest, EncryptionHandler } from "../types";
import { decryptMpegTsSampleAes } from "./transport_stream";

const AES_128_KEY = /^[0-9a-fA-F]{32}$/;
const AES_128_IV = /^[0-9a-fA-F]{1,32}$/;

export class MpegTsSampleAesHandler implements EncryptionHandler {
    readonly scheme = "mpeg-ts-sample-aes" as const;

    keyIds(encryption: DownloadEncryption): readonly string[] {
        if (encryption.scheme !== this.scheme) {
            throw new Error(`Invalid encryption descriptor for ${this.scheme}`);
        }
        return [encryption.keyId];
    }

    validate(
        encryption: DownloadEncryption,
        keys: ReadonlyMap<string, string>
    ): asserts encryption is MpegTsSampleAesEncryption {
        if (encryption.scheme !== this.scheme) {
            throw new Error(`Invalid encryption descriptor for ${this.scheme}`);
        }
        const key = keys.get(encryption.keyId);
        if (!key) {
            throw new Error(`Missing encryption key for ${encryption.keyId}`);
        }
        if (!AES_128_KEY.test(key)) {
            throw new Error("SAMPLE-AES key must contain exactly 16 bytes of hexadecimal data.");
        }
        if (!AES_128_IV.test(encryption.iv)) {
            throw new Error("SAMPLE-AES IV must contain 1 to 16 bytes of hexadecimal data.");
        }
    }

    async decrypt(request: DecryptionRequest): Promise<void> {
        const { inputPath, outputPath, encryption, keys } = request;
        this.validate(encryption, keys);
        const key = keys.get(encryption.keyId)!;
        const temporaryOutputPath = `${outputPath}.t-${process.pid}-${randomUUID()}`;
        try {
            const encrypted = await fs.promises.readFile(inputPath);
            const decrypted = decryptMpegTsSampleAes(
                encrypted,
                Buffer.from(key, "hex"),
                Buffer.from(encryption.iv.padStart(32, "0"), "hex")
            );
            await fs.promises.writeFile(temporaryOutputPath, decrypted, { flag: "wx" });
            await fs.promises.rename(temporaryOutputPath, outputPath);
        } catch (error) {
            await fs.promises.rm(temporaryOutputPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
}
