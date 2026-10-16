import { spawn } from "child_process";

export interface ExecutableRunner {
    isAvailable(command: string, versionArguments: readonly string[]): Promise<boolean>;
    run(command: string, arguments_: readonly string[]): Promise<void>;
}

/** Retains process status so each tool adapter can interpret its own exit-code conventions. */
export class ExecutableExitError extends Error {
    constructor(
        command: string,
        readonly exitCode: number | null,
        readonly diagnostic: string,
    ) {
        super(
            `${command} exited with code ${exitCode === null ? "unknown" : exitCode}${diagnostic ? `: ${diagnostic}` : "."}`,
        );
        this.name = "ExecutableExitError";
    }
}

const MAX_DIAGNOSTIC_BYTES = 1024 * 1024;

function captureDiagnostics(stream: NodeJS.ReadableStream): () => string {
    const chunks: Buffer[] = [];
    let retainedBytes = 0;
    let truncated = false;
    stream.on("data", (chunk: Buffer | string) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = MAX_DIAGNOSTIC_BYTES - retainedBytes;
        if (data.length > remaining) {
            truncated = true;
        }
        if (remaining > 0) {
            // Copy a capped prefix so one oversized chunk cannot retain its entire backing allocation.
            const retained = data.length <= remaining ? data : Buffer.from(data.subarray(0, remaining));
            chunks.push(retained);
            retainedBytes += retained.length;
        }
    });
    return () => Buffer.concat(chunks).toString().trim() + (truncated ? "\n[diagnostic output truncated]" : "");
}

/** Executes binaries directly so media paths are never interpreted by a shell. */
export class SystemExecutableRunner implements ExecutableRunner {
    async isAvailable(command: string, versionArguments: readonly string[]): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const child = spawn(command, versionArguments, { stdio: "ignore" });
            // Spawn failure may also emit close; the promise preserves the first result.
            child.once("error", () => resolve(false));
            child.once("close", (code) => resolve(code === 0));
        });
    }

    async run(command: string, arguments_: readonly string[]): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const child = spawn(command, [...arguments_], {
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            });
            // mkvmerge writes warnings to stdout; retain both channels without accumulating unbounded progress output.
            const stdout = captureDiagnostics(child.stdout);
            const stderr = captureDiagnostics(child.stderr);
            child.once("error", reject);
            child.once("close", (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }
                const detail = [stderr(), stdout()].filter(Boolean).join("\n");
                reject(new ExecutableExitError(command, code, detail));
            });
        });
    }
}
