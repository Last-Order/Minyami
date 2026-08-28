import * as fs from "fs";
import * as path from "path";
import { describe, expect, jest, test } from "@jest/globals";
import FileConcentrator from "@/core/download/output/file_concentrator";
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

    test("replays the required prefix when a dropped item starts a new run", async () => {
        await withTempDirectory("minyami-concentrator-fmp4-gap-", async (directory) => {
            const initialization = createChunk(directory, "init.mp4", "init");
            const first = createChunk(directory, "0.m4s", "first");
            const second = createChunk(directory, "2.m4s", "second");
            const output = path.join(directory, "gapped.mp4");
            const concentrator = new FileConcentrator({ outputPath: output });
            const prefix = { slot: "fixture-prefix", identity: "a" } as const;

            concentrator.markTaskReady({
                filePath: initialization,
                index: 0,
                output: { replayablePrefix: prefix, startsNewRun: true },
            });
            concentrator.markTaskReady({ filePath: first, index: 1, output: { requiredPrefixes: [prefix] } });
            concentrator.markTaskDropped(2);
            concentrator.markTaskReady({ filePath: second, index: 3, output: { requiredPrefixes: [prefix] } });
            await concentrator.waitAllFilesWritten(4);

            const outputPaths = [path.join(directory, "gapped_0.mp4"), path.join(directory, "gapped_1.mp4")];
            expect(concentrator.getOutputFilePaths()).toEqual(outputPaths);
            expect(fs.readFileSync(outputPaths[0], "utf8")).toBe("initfirst");
            expect(fs.readFileSync(outputPaths[1], "utf8")).toBe("initsecond");
        });
    });

    test("starts a new run when a replayable prefix changes and supports returning to an earlier identity", async () => {
        await withTempDirectory("minyami-concentrator-fmp4-map-change-", async (directory) => {
            const initA = createChunk(directory, "init-a.mp4", "init-a");
            const mediaA = createChunk(directory, "a.m4s", "media-a");
            const initB = createChunk(directory, "init-b.mp4", "init-b");
            const mediaB = createChunk(directory, "b.m4s", "media-b");
            const initAAgain = createChunk(directory, "init-a-again.mp4", "init-a");
            const mediaAAgain = createChunk(directory, "a-again.m4s", "media-a-again");
            const output = path.join(directory, "rotated.mp4");
            const concentrator = new FileConcentrator({ outputPath: output });
            const prefixA = { slot: "fixture-prefix", identity: "a" } as const;
            const prefixB = { slot: "fixture-prefix", identity: "b" } as const;

            concentrator.markTaskReady({
                filePath: initA,
                index: 0,
                output: { replayablePrefix: prefixA, startsNewRun: true },
            });
            concentrator.markTaskReady({ filePath: mediaA, index: 1, output: { requiredPrefixes: [prefixA] } });
            concentrator.markTaskReady({
                filePath: initB,
                index: 2,
                output: { replayablePrefix: prefixB, startsNewRun: true },
            });
            concentrator.markTaskReady({ filePath: mediaB, index: 3, output: { requiredPrefixes: [prefixB] } });
            concentrator.markTaskReady({
                filePath: initAAgain,
                index: 4,
                output: { replayablePrefix: prefixA, startsNewRun: true },
            });
            concentrator.markTaskReady({
                filePath: mediaAAgain,
                index: 5,
                output: { requiredPrefixes: [prefixA] },
            });
            await concentrator.waitAllFilesWritten(6);

            const outputPaths = [
                path.join(directory, "rotated_0.mp4"),
                path.join(directory, "rotated_1.mp4"),
                path.join(directory, "rotated_2.mp4"),
            ];
            expect(concentrator.getOutputFilePaths()).toEqual(outputPaths);
            expect(fs.readFileSync(outputPaths[0], "utf8")).toBe("init-amedia-a");
            expect(fs.readFileSync(outputPaths[1], "utf8")).toBe("init-bmedia-b");
            expect(fs.readFileSync(outputPaths[2], "utf8")).toBe("init-amedia-a-again");
        });
    });

    test("fails finalization when a required prefix was never published", async () => {
        await withTempDirectory("minyami-concentrator-missing-prefix-", async (directory) => {
            const media = createChunk(directory, "payload.chunk", "payload");
            const concentrator = new FileConcentrator({ outputPath: path.join(directory, "missing.bin") });

            concentrator.markTaskReady({
                filePath: media,
                index: 0,
                output: { requiredPrefixes: [{ slot: "fixture-prefix", identity: "missing" }] },
            });

            await expect(concentrator.waitAllFilesWritten(1)).rejects.toThrow("Required output prefix is unavailable");
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
