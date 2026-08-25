import * as fs from "fs";
import * as path from "path";
import logger from "@/utils/log";
import { DownloadOutputLayout, DownloadOutputPrefix } from "@/core/source/types";

// Read streams produce 64 KiB chunks by default. A larger, finite output buffer
// preserves read/write overlap and writev opportunities without unbounded queueing.
const OUTPUT_HIGH_WATER_MARK = 1024 * 1024;

interface FileConcentratorParams {
    /** Final public path; numbered staging paths are derived from it. */
    outputPath: string;
    /** Remove each temporary input only after all of its write callbacks succeed. */
    deleteAfterWritten?: boolean;
    /** Concatenate across dropped indices instead of starting a new output run. */
    ignoreBreakpoints?: boolean;
}

/** A terminal successful task result. The index is its discovery/merge order. */
interface ReadyTask {
    filePath: string;
    index: number;
    output?: DownloadOutputLayout;
}

type ConcentrationOutcome =
    | {
          kind: "file";
          filePath: string;
          output?: DownloadOutputLayout;
      }
    | { kind: "dropped" };

function prefixKey(prefix: DownloadOutputPrefix): string {
    return JSON.stringify([prefix.slot, prefix.identity]);
}

function toError(error: unknown): Error {
    // Jest and stream internals may surface errors from another realm, where instanceof is false.
    if (
        typeof error === "object" &&
        error !== null &&
        "name" in error &&
        typeof error.name === "string" &&
        "message" in error &&
        typeof error.message === "string"
    ) {
        return error as Error;
    }
    return new Error(String(error));
}

/**
 * Incrementally merges terminal task outcomes while preserving discovery order.
 *
 * The downloader may report outcomes in any completion order, but it assigns task
 * indices monotonically during discovery. This class consumes only the longest
 * contiguous terminal prefix beginning at `nextIndex`; a later ready file remains
 * buffered until every earlier index is either ready or explicitly dropped.
 *
 * Invariants:
 * - only the serialized drain advances `nextIndex` or mutates the output stream;
 * - `pendingOutcomes` contains only unconsumed indices at or beyond `nextIndex`;
 * - a dropped index after written data arms one split before the next ready file;
 * - a temporary input is deletable only after all writes sourced from it complete;
 * - finalization verifies one terminal outcome for every discovered task.
 *
 * Outcome recording is intentionally non-blocking so merge I/O does not occupy a
 * download worker or turn a global output failure into a per-task retry. The drain
 * retains its first failure and finalization exposes it to the downloader.
 */
class FileConcentrator {
    /** Out-of-order outcomes waiting for the ordered frontier to reach them. */
    private readonly pendingOutcomes = new Map<number, ConcentrationOutcome>();

    /** Base and extension used to derive numbered staging paths. */
    private readonly outputFilename: string;

    private readonly outputFileExt: string;

    private readonly requestedOutputPath: string;

    private readonly deleteAfterWritten: boolean;

    private readonly ignoreBreakpoints: boolean;

    /** Actual staging/final paths, recorded only after their streams open successfully. */
    private readonly outputFilePaths: string[] = [];

    /** The sole ordered frontier: no index greater than this may be consumed first. */
    private nextIndex = 0;

    /** At most one output run is open, and only the drain may replace it. */
    private writeStream?: fs.WriteStream;

    /** Multiple consecutive drops collapse into one lazy split before the next file. */
    private splitBeforeNextFile = false;

    /** One opaque replayable prefix is retained per source-defined slot. */
    private readonly replayablePrefixes = new Map<string, { readonly identity: string; readonly data: Buffer }>();

    /** Prefix identities already present in the currently open output run. */
    private readonly emittedPrefixes = new Set<string>();

    /** Distinguishes leading drops from a gap after real output data. */
    private hasWrittenFile = false;

    /** Finalization closes outcome admission before validating the complete sequence. */
    private acceptingOutcomes = true;

    /** Hard abort ignores late worker outcomes and preserves recoverable temporary files. */
    private aborted = false;

    /** These fields serialize drain work without making outcome recording await I/O. */
    private drainScheduled = false;

    private drainPromise: Promise<void> = Promise.resolve();

    private drainError?: Error;

    /** Caches finalization so repeated callers observe the same completion or failure. */
    private finalization?: Promise<void>;

    constructor({ outputPath, deleteAfterWritten = false, ignoreBreakpoints = false }: FileConcentratorParams) {
        const parsedOutputPath = path.parse(outputPath);
        this.outputFilename = path.join(parsedOutputPath.dir, parsedOutputPath.name);
        this.outputFileExt = parsedOutputPath.ext;
        this.requestedOutputPath = outputPath;
        this.deleteAfterWritten = deleteAfterWritten;
        this.ignoreBreakpoints = ignoreBreakpoints;
    }

    public markTaskReady(task: ReadyTask): void {
        // Recording the path transfers no file ownership until the drain writes it successfully.
        this.recordOutcome(task.index, {
            kind: "file",
            filePath: task.filePath,
            ...(task.output ? { output: task.output } : {}),
        });
        this.scheduleDrain();
    }

    public markTaskDropped(index: number): void {
        // A terminal drop is an ordered outcome: it unblocks later successful tasks.
        this.recordOutcome(index, { kind: "dropped" });
        this.scheduleDrain();
    }

    /**
     * Finalization starts only after discovery and execution have ended, so every
     * discovered index must already have either a file or a dropped outcome.
     */
    public waitAllFilesWritten(expectedTaskCount: number): Promise<void> {
        if (!this.finalization) {
            this.finalization = this.finalize(expectedTaskCount);
        }
        return this.finalization;
    }

    public getOutputFilePaths(): string[] {
        // Do not expose the mutable internal list while finalization may rename its only entry.
        return [...this.outputFilePaths];
    }

    public abort(): void {
        // Hard cancellation preserves partial output and temporary files for manual recovery.
        this.aborted = true;
        this.acceptingOutcomes = false;
        this.writeStream?.destroy();
        this.writeStream = undefined;
    }

    private recordOutcome(index: number, outcome: ConcentrationOutcome): void {
        if (this.aborted) {
            // Running workers may finish after hard stop; their temporary files remain recoverable.
            return;
        }
        if (!this.acceptingOutcomes) {
            throw new Error("Cannot add file concentration outcomes after finalization has started.");
        }
        // Duplicate or already-consumed indices indicate a downloader lifecycle bug.
        if (index < this.nextIndex || this.pendingOutcomes.has(index)) {
            throw new Error(`File concentration outcome already recorded for task ${index}.`);
        }
        this.pendingOutcomes.set(index, outcome);
    }

    private scheduleDrain(): void {
        if (this.drainScheduled || this.drainError) {
            // The active drain observes new outcomes; after a failure, finalization owns propagation.
            return;
        }
        this.drainScheduled = true;
        // Keeping one serialized drain chain makes output order independent of task completion order.
        this.drainPromise = this.drainPromise.then(async () => {
            try {
                await this.drainAvailableOutcomes();
            } catch (error) {
                // Outcome recording is non-blocking; finalization is the error propagation boundary.
                this.drainError = toError(error);
            } finally {
                this.drainScheduled = false;
                // An outcome may arrive while a stream operation is awaiting I/O.
                if (!this.drainError && this.pendingOutcomes.has(this.nextIndex)) {
                    this.scheduleDrain();
                }
            }
        });
    }

    private async drainAvailableOutcomes(): Promise<void> {
        // Stop at the first unresolved index; consuming a later outcome would reorder output.
        let outcome = this.pendingOutcomes.get(this.nextIndex);
        while (outcome) {
            const index = this.nextIndex;
            if (outcome.kind === "dropped") {
                // Initial gaps need no empty output; later gaps split the next successful run.
                if (!this.ignoreBreakpoints && this.hasWrittenFile) {
                    this.splitBeforeNextFile = true;
                }
            } else {
                await this.writeFile(outcome, index);
            }
            this.pendingOutcomes.delete(index);
            // Delete before advancing so the Map never retains successfully consumed file paths.
            this.nextIndex++;
            outcome = this.pendingOutcomes.get(this.nextIndex);
        }
    }

    private async writeFile(outcome: Extract<ConcentrationOutcome, { kind: "file" }>, index: number): Promise<void> {
        const { filePath, output: layout } = outcome;
        const replayablePrefix = layout?.replayablePrefix;
        if (replayablePrefix) {
            const data = await fs.promises.readFile(filePath);
            this.replayablePrefixes.set(replayablePrefix.slot, {
                identity: replayablePrefix.identity,
                data,
            });
        }
        if (layout?.startsNewRun && this.writeStream) {
            await this.closeWriteStream();
            this.splitBeforeNextFile = false;
        }
        if (this.splitBeforeNextFile) {
            // Rotation is lazy: trailing drops must not create an empty final output.
            logger.debug(`Create a new output after the gap before task ${index}.`);
            await this.closeWriteStream();
            this.splitBeforeNextFile = false;
        }
        // Leading drops likewise produce no empty numbered staging files.
        const output = this.writeStream ?? (await this.createNextWriteStream());
        await this.appendRequiredPrefixes(layout?.requiredPrefixes ?? [], output);
        await this.appendFile(filePath, output);
        if (replayablePrefix) {
            this.emittedPrefixes.add(prefixKey(replayablePrefix));
        }
        this.hasWrittenFile = true;

        if (this.deleteAfterWritten) {
            try {
                await fs.promises.unlink(filePath);
            } catch {
                // The stream completed this input; cleanup failure must not invalidate the output.
                logger.warning(`Failed to delete temporary file [${filePath}].`);
            }
        }
    }

    private appendBuffer(data: Buffer, output: fs.WriteStream): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            output.write(data, (error) => (error ? reject(error) : resolve()));
        });
    }

    private async appendRequiredPrefixes(
        prefixes: readonly DownloadOutputPrefix[],
        output: fs.WriteStream
    ): Promise<void> {
        const missing = prefixes.filter((prefix) => !this.emittedPrefixes.has(prefixKey(prefix)));
        if (missing.length > 0 && output.bytesWritten !== 0) {
            throw new Error("Required output prefixes are not present in the current output run.");
        }
        for (const prefix of missing) {
            const cached = this.replayablePrefixes.get(prefix.slot);
            if (!cached || cached.identity !== prefix.identity) {
                throw new Error(`Required output prefix is unavailable for slot ${prefix.slot}.`);
            }
            await this.appendBuffer(cached.data, output);
            this.emittedPrefixes.add(prefixKey(prefix));
        }
    }

    private async appendFile(filePath: string, output: fs.WriteStream): Promise<void> {
        // Backpressure and write completion are separate signals: `drain` permits more
        // buffering, while the callback count proves every write from this input ended.
        let pendingWrites = 0;
        let inputEnded = false;
        let writeError: Error | undefined;
        let appendError: Error | undefined;
        let resolveWritesCompleted!: () => void;
        const writesCompleted = new Promise<void>((resolve) => {
            resolveWritesCompleted = resolve;
        });
        const completeWrite = (error?: Error | null) => {
            // Preserve the first write failure while still settling every queued callback.
            if (error && !writeError) {
                writeError = toError(error);
            }
            pendingWrites--;
            if (inputEnded && pendingWrites === 0) {
                resolveWritesCompleted();
            }
        };

        try {
            for await (const chunk of fs.createReadStream(filePath)) {
                // A callback may fail while the input iterator is preparing its next chunk.
                if (writeError) {
                    throw writeError;
                }
                pendingWrites++;
                let writable: boolean;
                try {
                    writable = output.write(chunk, completeWrite);
                } catch (error) {
                    // A synchronous refusal never owns a callback, so undo its reservation.
                    pendingWrites--;
                    throw error;
                }
                if (!writable) {
                    // The stream buffer bounds queued data while callbacks track completed writes.
                    await this.waitForStreamDrain(output);
                }
            }
        } catch (error) {
            // Defer throwing until already queued writes settle; otherwise they could fail unobserved.
            appendError = toError(error);
        } finally {
            inputEnded = true;
            if (pendingWrites === 0) {
                resolveWritesCompleted();
            }
        }

        // drain only reports buffer capacity; every callback must finish before the input can be deleted.
        await writesCompleted;
        if (writeError) {
            throw writeError;
        }
        if (appendError) {
            throw appendError;
        }
    }

    private waitForStreamDrain(stream: fs.WriteStream): Promise<void> {
        return new Promise((resolve, reject) => {
            // Every exit removes all three listeners; this helper is safe for long-lived outputs.
            const cleanup = () => {
                stream.off("drain", onDrain);
                stream.off("error", onError);
                stream.off("close", onClose);
            };
            const onDrain = () => {
                cleanup();
                resolve();
            };
            const onError = (error: Error) => {
                cleanup();
                reject(error);
            };
            const onClose = () => {
                cleanup();
                reject(stream.errored || new Error("Output stream closed before it became writable."));
            };
            stream.once("drain", onDrain);
            stream.once("error", onError);
            stream.once("close", onClose);
        });
    }

    private async createNextWriteStream(): Promise<fs.WriteStream> {
        const sequence = this.outputFilePaths.length;
        const outputPath = `${this.outputFilename}_${sequence}${this.outputFileExt}`;
        const stream = fs.createWriteStream(outputPath, {
            // Exclusive creation turns an output-name race into an error instead of truncation.
            flags: "wx",
            highWaterMark: OUTPUT_HIGH_WATER_MARK,
        });
        this.writeStream = stream;
        // Keep an error observer attached between input writes so late stream errors are never unhandled.
        stream.on("error", (error) => {
            this.drainError = this.drainError ?? toError(error);
        });
        await new Promise<void>((resolve, reject) => {
            // Do not publish the path until asynchronous open succeeds.
            const onOpen = () => {
                stream.off("error", onError);
                resolve();
            };
            const onError = (error: Error) => {
                stream.off("open", onOpen);
                reject(error);
            };
            stream.once("open", onOpen);
            stream.once("error", onError);
        });
        if (this.aborted) {
            stream.destroy();
            this.writeStream = undefined;
            throw new Error("File concentration was aborted.");
        }
        this.outputFilePaths.push(outputPath);
        logger.debug(`Created output stream ${sequence}.`);
        return stream;
    }

    private async closeWriteStream(): Promise<void> {
        const stream = this.writeStream;
        if (!stream) {
            return;
        }
        this.writeStream = undefined;
        this.emittedPrefixes.clear();
        await new Promise<void>((resolve, reject) => {
            // `finish`, not merely `end()`, confirms all queued writes completed.
            const onError = (error: Error) => {
                stream.off("finish", onFinish);
                reject(error);
            };
            const onFinish = () => {
                stream.off("error", onError);
                resolve();
            };
            stream.once("error", onError);
            stream.once("finish", onFinish);
            stream.end();
        });
    }

    private async finalize(expectedTaskCount: number): Promise<void> {
        this.acceptingOutcomes = false;
        // Scheduler drain has ended, so this is the final chance to consume a ready prefix.
        this.scheduleDrain();
        await this.waitForDrain();

        if (this.drainError) {
            this.writeStream?.destroy();
            this.writeStream = undefined;
            throw this.drainError;
        }

        if (this.nextIndex !== expectedTaskCount || this.pendingOutcomes.size !== 0) {
            // A missing outcome is a downloader lifecycle violation, not an implicit drop.
            await this.closeWriteStream();
            throw new Error(
                `Cannot finalize file concentration: expected ${expectedTaskCount} task outcomes, consumed ${this.nextIndex}.`
            );
        }

        await this.closeWriteStream();
        if (this.outputFilePaths.length === 1) {
            // Numbered names avoid exposing the final name until the only output is complete.
            await fs.promises.rename(this.outputFilePaths[0], this.requestedOutputPath);
            this.outputFilePaths[0] = this.requestedOutputPath;
        }
    }

    private async waitForDrain(): Promise<void> {
        while (true) {
            const activeDrain = this.drainPromise;
            await activeDrain;
            // A drain may enqueue its successor in `finally`; identity prevents an early return.
            if (activeDrain === this.drainPromise && !this.drainScheduled) {
                return;
            }
        }
    }
}

export default FileConcentrator;
