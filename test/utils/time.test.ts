import { describe, expect, test } from "@jest/globals";
import { timeStringToSeconds } from "@/utils/time";

describe("timeStringToSeconds", () => {
    test("converts minute and hour timestamps", () => {
        expect(timeStringToSeconds("45:00")).toBe(2700);
        expect(timeStringToSeconds("01:02:03")).toBe(3723);
    });

    test.each(["12", "1:", ":30", "1:two"])("rejects invalid timestamp %s", (value) => {
        expect(() => timeStringToSeconds(value)).toThrow("Invalid time string");
    });
});
