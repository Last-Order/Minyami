import { describe, expect, test } from "@jest/globals";
import { parseLeadingId3Tags } from "@/core/packed_audio";

describe("Packed Audio framing", () => {
    test.each([
        ["truncated tag", Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4]), "truncated ID3 tag"],
        ["invalid syncsafe size", Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0x80, 0, 0, 0]), "syncsafe"],
    ])("rejects %s", (_name, data, message) => {
        expect(() => parseLeadingId3Tags(data)).toThrow(message);
    });
});
