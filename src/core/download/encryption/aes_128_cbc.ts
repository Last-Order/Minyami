import * as crypto from "crypto";
import * as fs from "fs";
import { pipeline } from "stream/promises";
import { Aes128CbcEncryption, DownloadEncryption } from "../../source/types";
import { DecryptionRequest, EncryptionHandler } from "./types";

const AES_128_KEY = /^[0-9a-fA-F]{32}$/;
const AES_128_IV = /^[0-9a-fA-F]{1,32}$/;

export class Aes128CbcHandler implements EncryptionHandler {
    readonly scheme = "aes-128-cbc" as const;

    keyIds(encryption: DownloadEncryption): readonly string[] {
        if (encryption.scheme !== this.scheme) {
            throw new Error(`Invalid encryption descriptor for ${this.scheme}`);
        }
        return [encryption.keyId];
    }

    validate(
        encryption: DownloadEncryption,
        keys: ReadonlyMap<string, string>
    ): asserts encryption is Aes128CbcEncryption {
        if (encryption.scheme !== this.scheme) {
            throw new Error(`Invalid encryption descriptor for ${this.scheme}`);
        }
        const key = keys.get(encryption.keyId);
        if (!key) {
            throw new Error(`Missing encryption key for ${encryption.keyId}`);
        }
        if (!AES_128_KEY.test(key)) {
            throw new Error("AES-128 key must contain exactly 16 bytes of hexadecimal data.");
        }
        if (!AES_128_IV.test(encryption.iv)) {
            throw new Error("AES-128-CBC IV must contain 1 to 16 bytes of hexadecimal data.");
        }
    }

    async decrypt(request: DecryptionRequest): Promise<void> {
        const { inputPath, outputPath, encryption, keys } = request;
        this.validate(encryption, keys);
        const key = keys.get(encryption.keyId)!;

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
