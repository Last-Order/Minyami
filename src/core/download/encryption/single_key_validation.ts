import { DownloadEncryption } from "@/core/source/types";

type SingleKeyEncryption = Extract<DownloadEncryption, { readonly keyId: string }>;

/** These CBC schemes share key/IV encoding rules, but retain their algorithm-specific diagnostics. */
export function validateSingleKeyEncryption(encryption: SingleKeyEncryption, keys: ReadonlyMap<string, string>): void {
    const key = keys.get(encryption.keyId);
    if (!key) {
        throw new Error(`Missing encryption key for ${encryption.keyId}`);
    }
    const aes128 = encryption.scheme === "aes-128-cbc";
    if (!/^[0-9a-fA-F]{32}$/.test(key)) {
        throw new Error(`${aes128 ? "AES-128" : "SAMPLE-AES"} key must contain exactly 16 bytes of hexadecimal data.`);
    }
    if (!/^[0-9a-fA-F]{1,32}$/.test(encryption.iv)) {
        throw new Error(`${aes128 ? "AES-128-CBC" : "SAMPLE-AES"} IV must contain 1 to 16 bytes of hexadecimal data.`);
    }
}
