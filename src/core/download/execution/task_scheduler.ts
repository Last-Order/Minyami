export interface TaskSchedulerOptions<T, TResult> {
    concurrency: number;
    /** Attempt numbers start at one and are scheduler-owned rather than stored on tasks. */
    execute: (task: T, attempt: number) => Promise<TResult>;
    onSuccess?: (task: T, result: TResult) => Promise<void> | void;
    onError?: (task: T, error: unknown, attempt: number) => Promise<boolean> | boolean;
    /** Commit/policy failures are fatal and must stop the producer as well as this pool. */
    onFatal?: (error: unknown) => void;
}

const END = Symbol("scheduler-end");

interface QueuedTask<T> {
    readonly task: T;
    readonly attempt: number;
}

/**
 * A small open-ended worker pool. Producers may add work while it is running and
 * explicitly close it when no more work will arrive.
 */
export class TaskScheduler<T, TResult = void> {
    private readonly queue: QueuedTask<T>[] = [];
    private readonly waiters: Array<() => void> = [];
    private started = false;
    private closed = false;
    private aborted = false;
    private activeTasks = 0;
    private completion?: Promise<void>;

    constructor(private readonly options: TaskSchedulerOptions<T, TResult>) {
        if (options.concurrency < 1) {
            throw new Error("Task scheduler concurrency must be at least 1.");
        }
    }

    add(tasks: T | T[]): void {
        if (this.closed) {
            throw new Error("Cannot add tasks to a closed scheduler.");
        }
        const values = Array.isArray(tasks) ? tasks : [tasks];
        this.queue.push(...values.map((task) => ({ task, attempt: 1 })));
        this.notify();
    }

    start(): Promise<void> {
        if (!this.started) {
            this.started = true;
            const workers = Array.from({ length: this.options.concurrency }, () => this.runWorker());
            // Fatal completion still waits for sibling workers, keeping terminal snapshots stable.
            this.completion = Promise.allSettled(workers).then((results) => {
                const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
                if (failure) {
                    throw failure.reason;
                }
            });
        }
        return this.completion;
    }

    close(): void {
        // Close ends production without discarding work; workers exit only after the queue becomes empty.
        this.closed = true;
        this.notify();
    }

    abort(): void {
        // Active executions are settled by their caller-owned AbortSignal; this pool only discards queued work.
        this.queue.length = 0;
        this.closed = true;
        this.aborted = true;
        this.notify();
    }

    get pendingCount(): number {
        return this.queue.length;
    }

    get runningCount(): number {
        return this.activeTasks;
    }

    private async runWorker(): Promise<void> {
        while (true) {
            const queued = await this.take();
            if (queued === END) {
                return;
            }

            this.activeTasks++;
            try {
                let result: TResult;
                try {
                    result = await this.options.execute(queued.task, queued.attempt);
                } catch (error) {
                    let retry: boolean;
                    try {
                        retry = (await this.options.onError?.(queued.task, error, queued.attempt)) || false;
                    } catch (commitError) {
                        this.fail(commitError);
                        throw commitError;
                    }
                    if (retry && !this.aborted) {
                        // Prioritize the same ordered task so an early gap does not indefinitely buffer later output.
                        this.queue.unshift({ task: queued.task, attempt: queued.attempt + 1 });
                        this.notify();
                    }
                    continue;
                }

                // Commit failures are session failures; replaying an already successful task would duplicate output.
                try {
                    await this.options.onSuccess?.(queued.task, result);
                } catch (commitError) {
                    this.fail(commitError);
                    throw commitError;
                }
            } finally {
                this.activeTasks--;
            }
        }
    }

    private async take(): Promise<QueuedTask<T> | typeof END> {
        while (true) {
            const first = this.queue.shift();
            if (first !== undefined) {
                return first;
            }
            if (this.closed) {
                return END;
            }
            // An open, empty queue is not complete: a continuous source may publish another batch later.
            await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
    }

    private notify(): void {
        while (this.waiters.length > 0) {
            this.waiters.shift()();
        }
    }

    private fail(error: unknown): void {
        this.abort();
        this.options.onFatal?.(error);
    }
}
