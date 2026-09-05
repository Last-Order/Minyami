import { randomUUID } from "crypto";
import * as os from "os";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { SystemExecutableRunner } from "@/core/muxer/executable_runner";

describe("executable availability", () => {
    test.each([0, 1])("reports availability from exit code %i", async (code) => {
        const runner = new SystemExecutableRunner();

        await expect(runner.isAvailable(process.execPath, ["-e", `process.exit(${code})`])).resolves.toBe(code === 0);
    });

    test("reports a missing executable as unavailable", async () => {
        const runner = new SystemExecutableRunner();
        const missingCommand = path.join(os.tmpdir(), `minyami-missing-${randomUUID()}`, "executable");

        await expect(runner.isAvailable(missingCommand, [])).resolves.toBe(false);
    });
});
