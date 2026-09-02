import * as crypto from "crypto";
import { describe, expect, test } from "@jest/globals";
import { decryptSampleAesAudio } from "@/core/download/encryption/sample_aes/shared/audio";

const key = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const iv = Buffer.from("ffeeddccbbaa99887766554433221100", "hex");

describe("SAMPLE-AES elementary audio", () => {
    test("resets CBC for every AC-3 syncframe", () => {
        const first = createAc3Frame(3);
        const second = createAc3Frame(17);
        const clear = Buffer.concat([first, second]);
        const encrypted = Buffer.from(clear);

        encryptRanges(encrypted, encryptedRanges(0, first.length));
        encryptRanges(encrypted, encryptedRanges(first.length, second.length));

        expect(decryptSampleAesAudio(encrypted, "ac3", key, iv)).toEqual(clear);
    });

    test("continues E-AC-3 CBC over dependent syncframes and resets at the next independent frame", () => {
        const independent = createEac3Frame(0, 5);
        const dependent = createEac3Frame(1, 19);
        const nextIndependent = createEac3Frame(0, 31);
        const clear = Buffer.concat([independent, dependent, nextIndependent]);
        const encrypted = Buffer.from(clear);

        encryptRanges(encrypted, [
            ...encryptedRanges(0, independent.length),
            ...encryptedRanges(independent.length, dependent.length),
        ]);
        encryptRanges(encrypted, encryptedRanges(independent.length + dependent.length, nextIndependent.length));

        expect(decryptSampleAesAudio(encrypted, "eac3", key, iv)).toEqual(clear);
    });

    test("rejects an E-AC-3 payload that starts with a dependent syncframe", () => {
        expect(() => decryptSampleAesAudio(createEac3Frame(1, 7), "eac3", key, iv)).toThrow(
            "does not start with independent substream 0",
        );
    });
});

function createAc3Frame(seed: number): Buffer {
    // 48 kHz and frame-size code 0 produce a 128-byte AC-3 syncframe.
    const frame = createPayload(128, seed);
    frame[0] = 0x0b;
    frame[1] = 0x77;
    frame[4] = 0;
    return frame;
}

function createEac3Frame(streamType: 0 | 1, seed: number): Buffer {
    const length = 128;
    const frameSize = length / 2 - 1;
    const frame = createPayload(length, seed);
    frame[0] = 0x0b;
    frame[1] = 0x77;
    frame[2] = (streamType << 6) | ((frameSize >> 8) & 7);
    frame[3] = frameSize & 0xff;
    frame[4] = 0x30;
    return frame;
}

function createPayload(length: number, seed: number): Buffer {
    const data = Buffer.alloc(length);
    for (let index = 0; index < length; index++) {
        data[index] = (index * seed + 11) & 0xff;
    }
    return data;
}

function encryptedRanges(offset: number, length: number): number[] {
    const encryptedLength = Math.floor((length - 16) / 16) * 16;
    return Array.from({ length: encryptedLength / 16 }, (_value, index) => offset + 16 + index * 16);
}

function encryptRanges(data: Buffer, offsets: readonly number[]): void {
    const plaintext = Buffer.concat(offsets.map((offset) => data.subarray(offset, offset + 16)));
    const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
    cipher.setAutoPadding(false);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    offsets.forEach((offset, index) => ciphertext.copy(data, offset, index * 16, index * 16 + 16));
}
