import { spawn } from "child_process";
import { getAbortSignal } from "@/utils/abort";

const MAX_DIAGNOSTIC_BYTES = 1024 * 1024;

export interface Mp4DecryptRunResult {
    readonly stderr: string;
}

export interface Mp4DecryptRunner {
    run(arguments_: readonly string[]): Promise<Mp4DecryptRunResult>;
}

/** Runs Bento4 directly so paths and decryption keys are never interpreted by a shell. */
export class SystemMp4DecryptRunner implements Mp4DecryptRunner {
    run(arguments_: readonly string[]): Promise<Mp4DecryptRunResult> {
        const signal = getAbortSignal();
        return new Promise((resolve, reject) => {
            const child = spawn("mp4decrypt", [...arguments_], {
                stdio: ["ignore", "ignore", "pipe"],
                windowsHide: true,
                signal,
            });
            const stderr: Buffer[] = [];
            let stderrBytes = 0;
            let settled = false;
            const settle = (action: () => void) => {
                if (!settled) {
                    settled = true;
                    action();
                }
            };
            child.stderr.on("data", (chunk: Buffer | string) => {
                const data = Buffer.from(chunk);
                stderrBytes += data.length;
                if (stderrBytes <= MAX_DIAGNOSTIC_BYTES) {
                    stderr.push(data);
                    return;
                }
                child.kill();
                settle(() => reject(new Error("mp4decrypt diagnostic output exceeded 1 MiB.")));
            });
            child.once("error", (error) => settle(() => reject(error)));
            child.once("close", (code) => {
                settle(() => {
                    const detail = Buffer.concat(stderr).toString().trim();
                    if (code !== 0) {
                        reject(
                            new Error(
                                `mp4decrypt exited with code ${code === null ? "unknown" : code}${
                                    detail ? `: ${detail}` : "."
                                }`,
                            ),
                        );
                        return;
                    }
                    // Bento4 1.6 may print a processing error and still return zero.
                    if (/^ERROR:/m.test(detail)) {
                        reject(new Error(`mp4decrypt failed: ${detail}`));
                        return;
                    }
                    resolve({ stderr: detail });
                });
            });
        });
    }
}
