import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import logger from "@/utils/log";

describe("ConsoleLogger", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("colors terminal warnings even when stdout is redirected", () => {
        const result = spawnSync(
            process.execPath,
            [
                "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
                "--input-type=module",
                "-e",
                `
                    import logger from "./src/utils/log.ts";
                    Object.defineProperty(process.stderr, "isTTY", { value: true });
                    logger.info("status");
                    logger.warning("retry warning");
                `,
            ],
            {
                cwd: resolve(__dirname, "../.."),
                encoding: "utf8",
                env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: undefined, NODE_DISABLE_COLORS: undefined },
            },
        );

        expect(result.status).toBe(0);
        expect(result.stdout).toBe("[MINYAMI][INFO] status\n");
        expect(result.stderr).toBe("\u001b[33m[MINYAMI][WARN] retry warning\u001b[39m\n");
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
