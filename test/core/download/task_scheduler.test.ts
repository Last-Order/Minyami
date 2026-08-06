import { describe, expect, test } from "@jest/globals";
import { TaskScheduler } from "../../../src/core/download/task_scheduler";

describe("TaskScheduler", () => {
    test("accepts batches while running and drains them after close", async () => {
        const completed: number[] = [];
        let firstTaskCompleted!: () => void;
        const firstCompletion = new Promise<void>((resolve) => {
            firstTaskCompleted = resolve;
        });
        const scheduler = new TaskScheduler<number, number>({
            concurrency: 2,
            execute: async (task) => task * 2,
            onSuccess: (task, result) => {
                completed.push(result);
                if (task === 1) {
                    firstTaskCompleted();
                }
            },
        });

        scheduler.add(1);
        const completion = scheduler.start();
        await firstCompletion;
        scheduler.add([2, 3]);
        scheduler.close();
        await completion;

        expect(completed.sort((left, right) => left - right)).toEqual([2, 4, 6]);
        expect(scheduler.pendingCount).toBe(0);
        expect(scheduler.runningCount).toBe(0);
    });

    test("requeues work when the error handler requests a retry", async () => {
        const attempts = new Map<number, number>();
        const completed: number[] = [];
        const scheduler = new TaskScheduler<number, number>({
            concurrency: 1,
            execute: async (task) => {
                const attempt = (attempts.get(task) ?? 0) + 1;
                attempts.set(task, attempt);
                if (attempt === 1) {
                    throw new Error("retry once");
                }
                return task;
            },
            onSuccess: (_task, result) => {
                completed.push(result);
            },
            onError: () => true,
        });

        scheduler.add(1);
        const completion = scheduler.start();
        scheduler.close();
        await completion;

        expect(attempts.get(1)).toBe(2);
        expect(completed).toEqual([1]);
    });
});
