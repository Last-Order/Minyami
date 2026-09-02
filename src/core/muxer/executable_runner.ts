import { spawn } from "child_process";

export interface ExecutableRunner {
    isAvailable(command: string, versionArguments: readonly string[]): Promise<boolean>;
    run(command: string, arguments_: readonly string[]): Promise<void>;
}

/** Executes binaries directly so media paths are never interpreted by a shell. */
export class SystemExecutableRunner implements ExecutableRunner {
    async isAvailable(command: string, versionArguments: readonly string[]): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const child = spawn(command, versionArguments, { stdio: "ignore" });
            let settled = false;
            const settle = (available: boolean) => {
                if (!settled) {
                    settled = true;
                    resolve(available);
                }
            };
            child.once("error", () => settle(false));
            child.once("close", (code) => settle(code === 0));
        });
    }

    async run(command: string, arguments_: readonly string[]): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const child = spawn(command, [...arguments_], {
                stdio: ["ignore", "ignore", "pipe"],
                windowsHide: true,
            });
            const stderr: Buffer[] = [];
            child.stderr.on("data", (chunk: Buffer | string) => stderr.push(Buffer.from(chunk)));
            child.once("error", reject);
            child.once("close", (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }
                const detail = Buffer.concat(stderr).toString().trim();
                reject(
                    new Error(
                        `${command} exited with code ${code === null ? "unknown" : code}${detail ? `: ${detail}` : "."}`,
                    ),
                );
            });
        });
    }
}
