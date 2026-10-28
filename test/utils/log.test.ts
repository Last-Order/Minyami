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
            expect.stringContaining("Aborted due to critical error. Invalid encryption key."),
        );
    });

    test("suppresses only progress until every display is released and restores it once", () => {
        const info = jest.spyOn(console, "info").mockImplementation(() => undefined);
        const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        const releaseFirst = logger.suppressProgressLogs();
        const releaseSecond = logger.suppressProgressLogs();

        try {
            logger.progress("hidden progress");
            logger.info("ordinary message");
            logger.warning("retry warning");
            expect(info).toHaveBeenCalledTimes(1);
            expect(info).toHaveBeenCalledWith(expect.stringContaining("ordinary message"));
            expect(warning).toHaveBeenCalledWith(expect.stringContaining("retry warning"));

            releaseFirst();
            releaseFirst();
            logger.progress("another display is active");
            expect(info).toHaveBeenCalledTimes(1);
            releaseSecond();
            logger.progress("visible progress");
            expect(info).toHaveBeenCalledTimes(2);
            expect(info).toHaveBeenLastCalledWith(expect.stringContaining("visible progress"));
        } finally {
            releaseFirst();
            releaseSecond();
        }
    });
});
