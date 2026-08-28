import { describe, expect, test } from "@jest/globals";
import { Aes128CbcHandler } from "@/core/download/encryption/aes_128_cbc/handler";
import { EncryptionHandlerRegistry } from "@/core/download/encryption/registry";
import { KeyStore } from "@/core/download/infrastructure/key_store";

describe("EncryptionHandlerRegistry", () => {
    test("rejects an unsupported scheme", () => {
        const registry = new EncryptionHandlerRegistry([new Aes128CbcHandler()]);

        expect(() => registry.require("unsupported")).toThrow("Unsupported encryption scheme: unsupported");
    });

    test("resolves exactly the keys required by an encryption descriptor", () => {
        const handler = new Aes128CbcHandler();
        const registry = new EncryptionHandlerRegistry([handler]);
        const source = new KeyStore();
        source.set("test:key", "00".repeat(16));

        const resolved = registry.resolve({ scheme: "aes-128-cbc", keyId: "test:key", iv: "1" }, source);

        expect(resolved.handler).toBe(handler);
        expect([...resolved.keys]).toEqual([["test:key", "00".repeat(16)]]);
    });
});
