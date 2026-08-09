import * as crypto from "crypto";
import * as fs from "fs";
import { pipeline } from "stream/promises";
import { DownloadEncryption } from "../../source/types";
import { DecryptionRequest, EncryptionHandler } from "./types";

const AES_128_KEY = /^[0-9a-fA-F]{32}$/;
const AES_128_IV = /^[0-9a-fA-F]{1,32}$/;

export class Aes128CbcHandler implements EncryptionHandler {
    readonly scheme = "aes-128-cbc" as const;

    validate(encryption: DownloadEncryption, key: string): void {
        if (encryption.scheme !== this.scheme) {
            throw new Error(`Invalid encryption descriptor for ${this.scheme}`);
        }
        if (!AES_128_KEY.test(key)) {
            throw new Error("AES-128 key must contain exactly 16 bytes of hexadecimal data.");
        }
        if (!AES_128_IV.test(encryption.iv)) {
            throw new Error("AES-128-CBC IV must contain 1 to 16 bytes of hexadecimal data.");
        }
    }

    async decrypt(request: DecryptionRequest): Promise<void> {
        const { inputPath, outputPath, encryption, key } = request;
        this.validate(encryption, key);

        const normalizedIv = encryption.iv.padStart(32, "0");
        const temporaryOutputPath = outputPath + ".t";
        const decipher = crypto.createDecipheriv(
            this.scheme,
            Buffer.from(key, "hex"),
            Buffer.from(normalizedIv, "hex")
        );

        try {
            // Pipeline propagates failures from every stream; only a complete plaintext file is committed.
            await pipeline(fs.createReadStream(inputPath), decipher, fs.createWriteStream(temporaryOutputPath));
            await fs.promises.rename(temporaryOutputPath, outputPath);
        } catch (error) {
            await fs.promises.rm(temporaryOutputPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
}
