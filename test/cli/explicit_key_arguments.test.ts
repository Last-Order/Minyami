import { describe, expect, test } from "@jest/globals";
import { parseExplicitKeyArgument, parseExplicitKeyArguments } from "@/cli/explicit_key_arguments";

describe("explicit key arguments", () => {
    test("parses a key without a KID", () => {
        expect(parseExplicitKeyArgument("00112233445566778899aabbccddeeff")).toEqual({
            key: "00112233445566778899aabbccddeeff",
        });
    });

    test("parses the compact KID and key format", () => {
        expect(parseExplicitKeyArgument("asset-id:00112233445566778899aabbccddeeff")).toEqual({
            kid: "asset-id",
            key: "00112233445566778899aabbccddeeff",
        });
    });

    test("parses repeated option values as separate keys", () => {
        expect(parseExplicitKeyArguments(["first:key-a", "second:key-b"])).toEqual([
            { kid: "first", key: "key-a" },
            { kid: "second", key: "key-b" },
        ]);
    });

    test("does not expand a comma-separated option value", () => {
        expect(parseExplicitKeyArguments("key-a,key-b")).toEqual([{ key: "key-a,key-b" }]);
    });
});
