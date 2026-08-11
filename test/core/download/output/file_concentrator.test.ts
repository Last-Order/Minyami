import * as fs from "fs";
import * as path from "path";
import { describe, expect, jest, test } from "@jest/globals";
import FileConcentrator from "../../../../src/core/download/output/file_concentrator";
import { withTempDirectory } from "../../../helpers/filesystem";

function createChunk(directory: string, filename: string, content: string): string {
    const filePath = path.join(directory, filename);
    fs.writeFileSync(filePath, content);
    return filePath;
}

describe("FileConcentrator", () => {
    test("writes out-of-order results in discovery order", async () => {
        await withTempDirectory("minyami-concentrator-order-", async (directory) => {
            const first = createChunk(directory, "first.chunk", "first");
            const second = createChunk(directory, "second.chunk", "second");
            const output = path.join(directory, "ordered.ts");
            const concentrator = new FileConcentrator({ outputPath: output });

            concentrator.markTaskReady({ filePath: second, index: 1 });
            concentrator.markTaskReady({ filePath: first, index: 0 });
            await concentrator.waitAllFilesWritten(2);

            expect(fs.readFileSync(output, "utf8")).toBe("firstsecond");
            expect(concentrator.getOutputFilePaths()).toEqual([output]);
        });
    });

    test("splits successful runs around dropped tasks without creating empty edge outputs", async () => {
        await withTempDirectory("minyami-concentrator-gaps-", async (directory) => {
            const first = createChunk(directory, "first.chunk", "first");
            const second = createChunk(directory, "second.chunk", "second");
            const output = path.join(directory, "gapped.ts");
            const concentrator = new FileConcentrator({ outputPath: output, deleteAfterWritten: true });

            concentrator.markTaskReady({ filePath: second, index: 4 });
            concentrator.markTaskDropped(0);
            concentrator.markTaskReady({ filePath: first, index: 1 });
            concentrator.markTaskDropped(2);
            concentrator.markTaskDropped(3);
            concentrator.markTaskDropped(5);
            await concentrator.waitAllFilesWritten(6);

            const outputPaths = [path.join(directory, "gapped_0.ts"), path.join(directory, "gapped_1.ts")];
            expect(concentrator.getOutputFilePaths()).toEqual(outputPaths);
            expect(fs.readFileSync(outputPaths[0], "utf8")).toBe("first");
            expect(fs.readFileSync(outputPaths[1], "utf8")).toBe("second");
            expect(fs.existsSync(first)).toBe(false);
            expect(fs.existsSync(second)).toBe(false);
        });
    });

    test("can ignore dropped-task breakpoints", async () => {
        await withTempDirectory("minyami-concentrator-ignore-gap-", async (directory) => {
            const first = createChunk(directory, "first.chunk", "first");
            const second = createChunk(directory, "second.chunk", "second");
            const output = path.join(directory, "continuous.ts");
            const concentrator = new FileConcentrator({ outputPath: output, ignoreBreakpoints: true });

            concentrator.markTaskReady({ filePath: first, index: 0 });
            concentrator.markTaskDropped(1);
            concentrator.markTaskReady({ filePath: second, index: 2 });
            await concentrator.waitAllFilesWritten(3);

            expect(concentrator.getOutputFilePaths()).toEqual([output]);
            expect(fs.readFileSync(output, "utf8")).toBe("firstsecond");
        });
    });

    test("preserves an extensionless output path", async () => {
        await withTempDirectory("minyami-concentrator-extensionless-", async (directory) => {
            const dottedDirectory = path.join(directory, "parent.with.dots");
            fs.mkdirSync(dottedDirectory);
            const chunk = createChunk(directory, "input.chunk", "content");
            const output = path.join(dottedDirectory, "video");
            const concentrator = new FileConcentrator({ outputPath: output });

            concentrator.markTaskReady({ filePath: chunk, index: 0 });
            await concentrator.waitAllFilesWritten(1);

            expect(concentrator.getOutputFilePaths()).toEqual([output]);
            expect(fs.readFileSync(output, "utf8")).toBe("content");
        });
    });

    test("produces no output when every task is dropped", async () => {
        await withTempDirectory("minyami-concentrator-all-dropped-", async (directory) => {
            const output = path.join(directory, "empty.ts");
            const concentrator = new FileConcentrator({ outputPath: output });

            concentrator.markTaskDropped(1);
            concentrator.markTaskDropped(0);
            await concentrator.waitAllFilesWritten(2);

            expect(concentrator.getOutputFilePaths()).toEqual([]);
            expect(fs.existsSync(output)).toBe(false);
        });
    });

    test("rejects finalization when a discovered task has no outcome", async () => {
        await withTempDirectory("minyami-concentrator-missing-", async (directory) => {
            const later = createChunk(directory, "later.chunk", "later");
            const concentrator = new FileConcentrator({ outputPath: path.join(directory, "missing.ts") });

            concentrator.markTaskReady({ filePath: later, index: 1 });

            await expect(concentrator.waitAllFilesWritten(2)).rejects.toThrow("expected 2 task outcomes, consumed 0");
        });
    });

    test("propagates output stream creation failures", async () => {
        await withTempDirectory("minyami-concentrator-output-error-", async (directory) => {
            const chunk = createChunk(directory, "input.chunk", "content");
            const output = path.join(directory, "missing-parent", "output.ts");
            const concentrator = new FileConcentrator({ outputPath: output });

            concentrator.markTaskReady({ filePath: chunk, index: 0 });

            await expect(concentrator.waitAllFilesWritten(1)).rejects.toMatchObject({ code: "ENOENT" });
        });
    });

    test("waits for the output write callback before deleting an input file", async () => {
        await withTempDirectory("minyami-concentrator-write-completion-", async (directory) => {
            const createWriteStream = fs.createWriteStream;
            let writeCallCount = 0;
            let notifyWriteCompleted: () => void;
            const writeCompleted = new Promise<void>((resolve) => {
                notifyWriteCompleted = resolve;
            });
            let releaseWriteCallback: () => void;
            const writeCallbackReleased = new Promise<void>((resolve) => {
                releaseWriteCallback = resolve;
            });
            jest.spyOn(require("fs") as typeof fs, "createWriteStream").mockImplementation((filePath, options) => {
                const stream = createWriteStream(filePath, options);
                const write = stream.write.bind(stream);
                stream.write = ((chunk, encoding?, callback?) => {
                    writeCallCount++;
                    const callerCallback = typeof encoding === "function" ? encoding : callback;
                    const actualEncoding = typeof encoding === "string" ? encoding : undefined;
                    return write(chunk, actualEncoding, (error) => {
                        notifyWriteCompleted();
                        void writeCallbackReleased.then(() => callerCallback?.(error));
                    });
                }) as typeof stream.write;
                return stream;
            });

            const chunk = createChunk(directory, "input.chunk", "content".repeat(64 * 1024));
            const concentrator = new FileConcentrator({
                outputPath: path.join(directory, "output.ts"),
                deleteAfterWritten: true,
            });
            concentrator.markTaskReady({ filePath: chunk, index: 0 });

            await writeCompleted;
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(writeCallCount).toBeGreaterThan(1);
            expect(fs.existsSync(chunk)).toBe(true);

            releaseWriteCallback();
            await concentrator.waitAllFilesWritten(1);
            expect(fs.existsSync(chunk)).toBe(false);
        });
    });

    test("does not retain per-input listeners on the output stream", async () => {
        await withTempDirectory("minyami-concentrator-listeners-", async (directory) => {
            const createWriteStream = fs.createWriteStream;
            let outputStream: fs.WriteStream | undefined;
            jest.spyOn(require("fs") as typeof fs, "createWriteStream").mockImplementation((filePath, options) => {
                outputStream = createWriteStream(filePath, options);
                return outputStream;
            });
            const concentrator = new FileConcentrator({ outputPath: path.join(directory, "output.ts") });

            for (let index = 0; index < 20; index++) {
                concentrator.markTaskReady({
                    index,
                    filePath: createChunk(directory, `${index}.chunk`, String(index)),
                });
            }
            await concentrator.waitAllFilesWritten(20);

            expect(outputStream).toBeDefined();
            expect(outputStream.listenerCount("close")).toBe(0);
        });
    });
});
