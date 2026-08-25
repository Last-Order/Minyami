import { describe, expect, test } from "@jest/globals";
import { Aes128CbcHandler } from "../../../../src/core/download/encryption/aes_128_cbc";
import { EncryptionHandlerRegistry } from "../../../../src/core/download/encryption/registry";

describe("EncryptionHandlerRegistry", () => {
    test("returns the handler registered for a scheme", () => {
        const handler = new Aes128CbcHandler();
        const registry = new EncryptionHandlerRegistry([handler]);

        expect(registry.require("aes-128-cbc")).toBe(handler);
    });

    test("rejects an unsupported scheme", () => {
        const registry = new EncryptionHandlerRegistry([new Aes128CbcHandler()]);

        expect(() => registry.require("unsupported")).toThrow("Unsupported encryption scheme: unsupported");
    });
});
