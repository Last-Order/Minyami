import { describe, expect, test } from "@jest/globals";
import {
    inspectIsoBmffInitialization,
    validateClearIsoBmffFragment,
    validateClearIsoBmffInitialization,
} from "@/core/isobmff";
import { createClearInitialization, createMediaFragment, createProtectedInitialization } from "../helpers/isobmff";

describe("ISO-BMFF inspection", () => {
    test("finds protected cbcs tracks without parsing media samples", () => {
        expect(inspectIsoBmffInitialization(createProtectedInitialization(7))).toEqual({
            trackIds: [7],
            protectedTrackIds: [7],
            protectionSchemes: ["cbcs"],
        });
    });

    test("accepts clear initialization and media-fragment structures", () => {
        expect(() => validateClearIsoBmffInitialization(createClearInitialization())).not.toThrow();
        expect(() => validateClearIsoBmffFragment(createMediaFragment("clear"))).not.toThrow();
    });

    test("rejects a protected initialization as clear output", () => {
        expect(() => validateClearIsoBmffInitialization(createProtectedInitialization())).toThrow(
            "still contains protected"
        );
    });

    test("rejects malformed box bounds", () => {
        const malformed = Buffer.alloc(8);
        malformed.writeUInt32BE(32);
        malformed.write("ftyp", 4, 4, "latin1");
        expect(() => inspectIsoBmffInitialization(malformed)).toThrow("Invalid ISO-BMFF ftyp box size");
    });
});
