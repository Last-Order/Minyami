import { randomUUID } from "crypto";
import * as os from "os";
import * as path from "path";
import { describe, expect, test } from "@jest/globals";
import { ExecutableExitError, SystemExecutableRunner } from "@/core/muxer/executable_runner";

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

describe("executable results", () => {
    test("retains exit status and diagnostics from both output channels", async () => {
        const runner = new SystemExecutableRunner();
        const result = runner.run(process.execPath, [
            "-e",
            "process.stdout.write('Warning: stdout detail'); process.stderr.write('stderr detail'); process.exitCode = 1;",
        ]);

        await expect(result).rejects.toBeInstanceOf(ExecutableExitError);
        await expect(result).rejects.toMatchObject({
            exitCode: 1,
            diagnostic: "stderr detail\nWarning: stdout detail",
        });
    });

    test("bounds retained diagnostics while continuing to drain the process", async () => {
        const runner = new SystemExecutableRunner();
        const result = runner.run(process.execPath, [
            "-e",
            "process.stdout.write('x'.repeat(2 * 1024 * 1024)); process.exitCode = 2;",
        ]);

        await expect(result).rejects.toMatchObject({ exitCode: 2 });
        await result.catch((error: unknown) => {
            if (!(error instanceof ExecutableExitError)) {
                throw error;
            }
            expect(error.diagnostic).toContain("[diagnostic output truncated]");
            expect(error.diagnostic.length).toBeLessThan(1024 * 1024 + 100);
        });
    });
});
