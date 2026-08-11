import { describe, expect, test } from "@jest/globals";
import { KeyStore } from "../../../../src/core/download/infrastructure/key_store";

describe("KeyStore", () => {
    test("registers individual and batched encryption keys", () => {
        const keys = new KeyStore();
        keys.set("custom:first", "first-key");
        keys.setMany({
            "custom:second": "second-key",
            "custom:third": "third-key",
        });

        expect(keys.get("custom:first")).toBe("first-key");
        expect(keys.get("custom:second")).toBe("second-key");
        expect(keys.get("custom:third")).toBe("third-key");
    });
});
