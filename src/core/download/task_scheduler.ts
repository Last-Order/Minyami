export interface RetryDecision {
    retry: boolean;
    beforeRetry?: () => Promise<void>;
}

interface TaskItem<T> {
    kind: "task";
    value: T;
}

interface BarrierItem {
    kind: "barrier";
    run: () => Promise<void>;
    promise?: Promise<void>;
}

type QueueItem<T> = TaskItem<T> | BarrierItem;

export interface TaskSchedulerOptions<T, TResult> {
    concurrency: number;
    execute: (task: T) => Promise<TResult>;
    onSuccess?: (task: T, result: TResult) => Promise<void> | void;
    onError?: (task: T, error: unknown) => Promise<RetryDecision> | RetryDecision;
}

const END = Symbol("scheduler-end");

/**
 * A small open-ended worker pool. Producers may add work while it is running and
 * explicitly close it when no more work will arrive.
 */
export class TaskScheduler<T, TResult = void> {
    private readonly queue: QueueItem<T>[] = [];
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
        this.queue.push(...values.map((value): TaskItem<T> => ({ kind: "task", value })));
        this.notify();
    }

    addBarrier(run: () => Promise<void>): void {
        if (this.closed) {
            throw new Error("Cannot add a barrier to a closed scheduler.");
        }
        this.queue.push({ kind: "barrier", run });
        this.notify();
    }

    start(): Promise<void> {
        if (!this.started) {
            this.started = true;
            this.completion = Promise.all(
                Array.from({ length: this.options.concurrency }, () => this.runWorker())
            ).then(() => undefined);
        }
        return this.completion;
    }

    close(): void {
        this.closed = true;
        this.notify();
    }

    abort(): void {
        this.queue.length = 0;
        this.closed = true;
        this.aborted = true;
        this.notify();
    }

    get pendingCount(): number {
        return this.queue.filter((item) => item.kind === "task").length;
    }

    get runningCount(): number {
        return this.activeTasks;
    }

    private async runWorker(): Promise<void> {
        while (true) {
            const task = await this.take();
            if (task === END) {
                return;
            }

            this.activeTasks++;
            try {
                const result = await this.options.execute(task);
                await this.options.onSuccess?.(task, result);
            } catch (error) {
                const decision = (await this.options.onError?.(task, error)) || { retry: false };
                if (decision.retry && !this.aborted) {
                    this.queue.unshift({ kind: "task", value: task });
                    if (decision.beforeRetry) {
                        this.queue.unshift({ kind: "barrier", run: decision.beforeRetry });
                    }
                    this.notify();
                }
            } finally {
                this.activeTasks--;
            }
        }
    }

    private async take(): Promise<T | typeof END> {
        while (true) {
            const first = this.queue[0];
            if (first?.kind === "task") {
                this.queue.shift();
                return first.value;
            }
            if (first?.kind === "barrier") {
                if (!first.promise) {
                    first.promise = Promise.resolve()
                        .then(first.run)
                        .finally(() => {
                            if (this.queue[0] === first) {
                                this.queue.shift();
                            }
                            this.notify();
                        });
                }
                await first.promise;
                continue;
            }
            if (this.closed) {
                return END;
            }
            await new Promise<void>((resolve) => this.waiters.push(resolve));
        }
    }

    private notify(): void {
        while (this.waiters.length > 0) {
            this.waiters.shift()();
        }
    }
}
