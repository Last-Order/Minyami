import { describe, expect, test } from "@jest/globals";
import { hasAdtsHeader, parseLeadingId3Tags } from "@/core/packed_audio";

describe("Packed Audio framing", () => {
    test("locates ADTS after multiple ID3v2 tags", () => {
        const first = createId3Tag(Buffer.from("timestamp"));
        const second = createId3Tag(Buffer.from("description"));
        const adts = createAdtsHeader(64);
        const data = Buffer.concat([first, second, adts]);

        expect(parseLeadingId3Tags(data)).toEqual({ payloadOffset: first.length + second.length });
        expect(hasAdtsHeader(data, first.length + second.length)).toBe(true);
    });

    test("allows elementary audio without an ID3 envelope", () => {
        expect(parseLeadingId3Tags(Buffer.from("plain audio"))).toEqual({ payloadOffset: 0 });
    });

    test.each([
        ["truncated tag", Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4]), "truncated ID3 tag"],
        ["invalid syncsafe size", Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0x80, 0, 0, 0]), "syncsafe"],
    ])("rejects %s", (_name, data, message) => {
        expect(() => parseLeadingId3Tags(data)).toThrow(message);
    });
});

function createId3Tag(body: Buffer): Buffer {
    const header = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, body.length]);
    return Buffer.concat([header, body]);
}

function createAdtsHeader(frameLength: number): Buffer {
    return Buffer.from([
        0xff,
        0xf1,
        0x4c,
        0x80 | ((frameLength >> 11) & 3),
        (frameLength >> 3) & 0xff,
        ((frameLength & 7) << 5) | 0x1f,
        0xfc,
    ]);
}
