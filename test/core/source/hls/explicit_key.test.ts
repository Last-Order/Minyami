import { describe, expect, test } from "@jest/globals";
import { parseHLSExplicitKey, parseHLSExplicitKeyInputs } from "@/core/source/hls/explicit_key";

describe("parseHLSExplicitKey", () => {
    test("parses a key without a KID", () => {
        expect(parseHLSExplicitKey("00112233445566778899aabbccddeeff")).toEqual({
            key: "00112233445566778899aabbccddeeff",
        });
    });

    test("parses the compact KID and key format", () => {
        expect(parseHLSExplicitKey("asset-id:00112233445566778899aabbccddeeff")).toEqual({
            kid: "asset-id",
            key: "00112233445566778899aabbccddeeff",
        });
    });

    test("parses repeated option values as separate keys", () => {
        expect(parseHLSExplicitKeyInputs(["first:key-a", "second:key-b"])).toEqual([
            { kid: "first", key: "key-a" },
            { kid: "second", key: "key-b" },
        ]);
    });

    test("does not expand a comma-separated option value", () => {
        expect(parseHLSExplicitKeyInputs("key-a,key-b")).toEqual([{ key: "key-a,key-b" }]);
    });
});
