import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { PackedAacSampleAesHandler } from "@/core/download/encryption/sample_aes/packed_aac/handler";
import { withTempDirectory } from "../../../helpers/filesystem";

const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const iv = Buffer.from("ffeeddccbbaa99887766554433221100", "hex");

describe("PackedAacSampleAesHandler", () => {
    test("preserves timed ID3 tags and decrypts every ADTS frame", async () => {
        await withTempDirectory("minyami-packed-aac-handler-", async (directory) => {
            const metadata = Buffer.concat([
                createId3Tag(Buffer.from("com.apple.streaming.transportStreamTimestamp")),
                createId3Tag(Buffer.from("com.apple.streaming.audioDescription")),
            ]);
            const first = createAdtsFrame(87, 3);
            const second = createAdtsFrame(103, 7);
            const clear = Buffer.concat([metadata, first, second]);
            const encrypted = Buffer.concat([metadata, encryptAdtsFrame(first), encryptAdtsFrame(second)]);
            const inputPath = path.join(directory, "encrypted.aac");
            const outputPath = path.join(directory, "clear.aac");
            fs.writeFileSync(inputPath, encrypted);

            const handler = new PackedAacSampleAesHandler();
            await handler.decrypt({
                inputPath,
                outputPath,
                encryption: {
                    scheme: "packed-aac-sample-aes",
                    keyId: "skd://fixture",
                    iv: iv.toString("hex"),
                },
                keys: new Map([["skd://fixture", key.toString("hex")]]),
                signal: new AbortController().signal,
            });

            expect(fs.readFileSync(outputPath)).toEqual(clear);
            expect(fs.readFileSync(inputPath)).toEqual(encrypted);
            expect(fs.readdirSync(directory).filter((name) => name.startsWith("clear.aac.t-"))).toEqual([]);
        });
    });

    test("decrypts ADTS input without requiring an ID3 envelope", async () => {
        await withTempDirectory("minyami-packed-aac-handler-no-id3-", async (directory) => {
            const inputPath = path.join(directory, "encrypted.aac");
            const outputPath = path.join(directory, "clear.aac");
            const clear = createAdtsFrame(87, 5);
            const encrypted = encryptAdtsFrame(clear);
            fs.writeFileSync(inputPath, encrypted);
            const handler = new PackedAacSampleAesHandler();

            await handler.decrypt({
                inputPath,
                outputPath,
                encryption: {
                    scheme: "packed-aac-sample-aes",
                    keyId: "skd://fixture",
                    iv: iv.toString("hex"),
                },
                keys: new Map([["skd://fixture", key.toString("hex")]]),
                signal: new AbortController().signal,
            });

            expect(fs.existsSync(inputPath)).toBe(true);
            expect(fs.readFileSync(outputPath)).toEqual(clear);
            expect(fs.readdirSync(directory).filter((name) => name.startsWith("clear.aac.t-"))).toEqual([]);
        });
    });

    test.each([
        ["invalid key", "z".repeat(32), iv.toString("hex"), "SAMPLE-AES key"],
        ["invalid IV", key.toString("hex"), "xy", "SAMPLE-AES IV"],
    ])("rejects an %s", (_name, invalidKey, invalidIv, message) => {
        const handler = new PackedAacSampleAesHandler();
        expect(() =>
            handler.validate(
                { scheme: "packed-aac-sample-aes", keyId: "skd://fixture", iv: invalidIv },
                new Map([["skd://fixture", invalidKey]])
            )
        ).toThrow(message);
    });
});

function createId3Tag(body: Buffer): Buffer {
    if (body.length > 0x7f) {
        throw new Error("Test ID3 body is too large.");
    }
    return Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, body.length]), body]);
}

function createAdtsFrame(length: number, seed: number): Buffer {
    const frame = Buffer.alloc(length);
    frame[0] = 0xff;
    frame[1] = 0xf1;
    frame[2] = 0x4c;
    frame[3] = 0x80 | ((length >> 11) & 3);
    frame[4] = (length >> 3) & 0xff;
    frame[5] = ((length & 7) << 5) | 0x1f;
    frame[6] = 0xfc;
    for (let index = 7; index < frame.length; index++) {
        frame[index] = (index * seed + 13) & 0xff;
    }
    return frame;
}

function encryptAdtsFrame(clear: Buffer): Buffer {
    const encrypted = Buffer.from(clear);
    const encryptedOffset = 7 + 16;
    const encryptedLength = Math.floor((clear.length - encryptedOffset) / 16) * 16;
    const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
    cipher.setAutoPadding(false);
    const ciphertext = Buffer.concat([
        cipher.update(clear.subarray(encryptedOffset, encryptedOffset + encryptedLength)),
        cipher.final(),
    ]);
    ciphertext.copy(encrypted, encryptedOffset);
    return encrypted;
}
