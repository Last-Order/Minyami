import { randomUUID } from "crypto";
import * as fs from "fs";
import { validateSingleKeyEncryption } from "@/core/download/encryption/single_key_validation";
import { DecryptionRequest, EncryptionHandler } from "@/core/download/encryption/types";
import { parseLeadingId3Tags } from "@/core/packed_audio";
import { DownloadEncryption, PackedAacSampleAesEncryption } from "@/core/source/types";
import { decryptSampleAesAudio } from "../shared/audio";

export class PackedAacSampleAesHandler implements EncryptionHandler {
    readonly scheme = "packed-aac-sample-aes" as const;

    keyIds(encryption: DownloadEncryption): readonly string[] {
        if (encryption.scheme !== this.scheme) {
            throw new Error(`Invalid encryption descriptor for ${this.scheme}`);
        }
        return [encryption.keyId];
    }

    validate(
        encryption: DownloadEncryption,
        keys: ReadonlyMap<string, string>,
    ): asserts encryption is PackedAacSampleAesEncryption {
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
            const { payloadOffset } = parseLeadingId3Tags(encrypted);
            // Timed ID3 metadata is part of the Packed Audio transport envelope and must survive decryption.
            const decryptedAudio = decryptSampleAesAudio(
                encrypted.subarray(payloadOffset),
                "aac",
                Buffer.from(key, "hex"),
                Buffer.from(encryption.iv.padStart(32, "0"), "hex"),
            );
            const decrypted = Buffer.concat([encrypted.subarray(0, payloadOffset), decryptedAudio]);
            await fs.promises.writeFile(temporaryOutputPath, decrypted, { flag: "wx" });
            await fs.promises.rename(temporaryOutputPath, outputPath);
        } catch (error) {
            await fs.promises.rm(temporaryOutputPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
}
