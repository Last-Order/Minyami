import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { Aes128CbcHandler } from "@/core/download/encryption/aes_128_cbc/handler";
import { withTempDirectory } from "../../../helpers/filesystem";

const key = Buffer.from("0123456789abcdef");
const keyHex = key.toString("hex");

function encrypt(plaintext: Buffer, iv: Buffer): Buffer {
    const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

describe("Aes128CbcHandler", () => {
    test("decrypts with a short hexadecimal IV without removing the input", async () => {
        await withTempDirectory("minyami-aes-handler-", async (directory) => {
            const inputPath = path.join(directory, "encrypted.ts");
            const outputPath = path.join(directory, "decrypted.ts");
            const iv = Buffer.alloc(16);
            iv[15] = 1;
            const plaintext = Buffer.from("aes handler payload");
            fs.writeFileSync(inputPath, encrypt(plaintext, iv));

            const handler = new Aes128CbcHandler();
            await handler.decrypt({
                inputPath,
                outputPath,
                encryption: { scheme: "aes-128-cbc", keyId: "test:key", iv: "1" },
                keys: new Map([["test:key", keyHex]]),
            });

            expect(fs.readFileSync(outputPath)).toEqual(plaintext);
            expect(fs.existsSync(inputPath)).toBe(true);
            expect(fs.existsSync(outputPath + ".t")).toBe(false);
        });
    });

    test.each([
        ["an empty key", "", "1", "Missing encryption key for test:key"],
        ["an empty IV", keyHex, "", "AES-128-CBC IV"],
        ["an invalid key", "z".repeat(32), "1", "AES-128 key"],
        ["a short key", "00", "1", "AES-128 key"],
        ["a non-hexadecimal IV", keyHex, "xy", "AES-128-CBC IV"],
        ["an oversized IV", keyHex, "00".repeat(17), "AES-128-CBC IV"],
    ])("rejects %s", (_name, invalidKey, iv, message) => {
        const handler = new Aes128CbcHandler();

        expect(() =>
            handler.validate({ scheme: "aes-128-cbc", keyId: "test:key", iv }, new Map([["test:key", invalidKey]])),
        ).toThrow(message);
    });

    test("removes a partial output after a stream failure", async () => {
        await withTempDirectory("minyami-aes-handler-failure-", async (directory) => {
            const inputPath = path.join(directory, "truncated.ts");
            const outputPath = path.join(directory, "decrypted.ts");
            fs.writeFileSync(inputPath, Buffer.from([1, 2, 3]));

            const handler = new Aes128CbcHandler();
            await expect(
                handler.decrypt({
                    inputPath,
                    outputPath,
                    encryption: { scheme: "aes-128-cbc", keyId: "test:key", iv: "1" },
                    keys: new Map([["test:key", keyHex]]),
                }),
            ).rejects.toThrow();

            expect(fs.existsSync(inputPath)).toBe(true);
            expect(fs.existsSync(outputPath)).toBe(false);
            expect(fs.existsSync(outputPath + ".t")).toBe(false);
        });
    });
});
