import { afterEach, describe, expect, jest, test } from "@jest/globals";
import logger from "@/utils/log";

describe("ConsoleLogger", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("shows an error cause without requiring debug mode", () => {
        const output = jest.spyOn(console, "info").mockImplementation(() => undefined);

        logger.error("Aborted due to critical error.", new Error("Invalid encryption key."));

        expect(output).toHaveBeenCalledWith(
            expect.stringContaining("Aborted due to critical error. Invalid encryption key.")
        );
    });
});
