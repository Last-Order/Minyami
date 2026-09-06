import * as crypto from "crypto";

export interface CbcDecryptJob {
    readonly data: Buffer;
    readonly blockOffsets: readonly number[];
    readonly iv: Buffer;
}

/**
 * Decrypts discontiguous CBC blocks without treating skipped clear bytes as part of the chain.
 * AES block decryption is batched through OpenSSL; only the CBC XOR and scatter are performed here.
 */
export function decryptCbcJobs(key: Buffer, jobs: readonly CbcDecryptJob[]): void {
    // Apple SAMPLE-AES §2.1 fixes both the AES-128 key and CBC block/IV size at 16 bytes and forbids padding.
    // https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/HLS_Sample_Encryption/Encryption/Encryption.html
    if (key.length !== 16) {
        throw new Error("SAMPLE-AES key must contain exactly 16 bytes.");
    }
    const blockCount = jobs.reduce((total, job) => total + job.blockOffsets.length, 0);
    if (blockCount === 0) {
        return;
    }
    const ciphertext = Buffer.allocUnsafe(blockCount * 16);
    let blockIndex = 0;
    for (const job of jobs) {
        if (job.iv.length !== 16) {
            throw new Error("SAMPLE-AES IV must contain exactly 16 bytes.");
        }
        for (const offset of job.blockOffsets) {
            if (!Number.isSafeInteger(offset) || offset < 0 || offset + 16 > job.data.length) {
                throw new Error("Invalid SAMPLE-AES encrypted block range.");
            }
            job.data.copy(ciphertext, blockIndex * 16, offset, offset + 16);
            blockIndex++;
        }
    }

    // SP 800-38A §6.2 defines CBC decryption as D_K(C_j) XOR C_(j-1), with the IV used for C_0.
    // ECB is used only to batch D_K here; the CBC XOR and protected-block IV reset are applied below.
    // https://nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-38a.pdf
    const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    // Complete AES blocks with padding disabled decrypt to exactly the ciphertext length.

    blockIndex = 0;
    for (const job of jobs) {
        let previous = job.iv;
        for (const offset of job.blockOffsets) {
            const cipherBlock = ciphertext.subarray(blockIndex * 16, blockIndex * 16 + 16);
            const plainBlock = decrypted.subarray(blockIndex * 16, blockIndex * 16 + 16);
            for (let index = 0; index < 16; index++) {
                job.data[offset + index] = plainBlock[index] ^ previous[index];
            }
            previous = cipherBlock;
            blockIndex++;
        }
    }
}
