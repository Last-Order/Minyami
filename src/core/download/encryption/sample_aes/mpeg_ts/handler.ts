import { randomUUID } from "crypto";
import * as fs from "fs";
import { validateSingleKeyEncryption } from "@/core/download/encryption/single_key_validation";
import { DecryptionRequest, EncryptionHandler } from "@/core/download/encryption/types";
import { DownloadEncryption, MpegTsSampleAesEncryption } from "@/core/source/types";
import { decryptMpegTsSampleAes } from "./transport_stream";

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
        keys: ReadonlyMap<string, string>,
    ): asserts encryption is MpegTsSampleAesEncryption {
        if (encryption.scheme !== this.scheme) {
            throw new Error(`Invalid encryption descriptor for ${this.scheme}`);
        }
        validateSingleKeyEncryption(encryption, keys);
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
                Buffer.from(encryption.iv.padStart(32, "0"), "hex"),
            );
            await fs.promises.writeFile(temporaryOutputPath, decrypted, { flag: "wx" });
            await fs.promises.rename(temporaryOutputPath, outputPath);
        } catch (error) {
            await fs.promises.rm(temporaryOutputPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
}
