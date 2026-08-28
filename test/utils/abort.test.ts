import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { createTimedAbortScope, getAbortSignal, iterateWithAbortSignal, runWithAbortSignal } from "@/utils/abort";

describe("AbortSignal async context", () => {
    test("keeps concurrent source and task branches isolated across awaits", async () => {
        const source = new AbortController();
        const task = new AbortController();

        const [sourceSignal, taskSignal] = await Promise.all([
            runWithAbortSignal(source.signal, async () => {
                await Promise.resolve();
                return getAbortSignal();
            }),
            runWithAbortSignal(task.signal, async () => {
                await Promise.resolve();
                return getAbortSignal();
            }),
        ]);

        expect(sourceSignal).toBe(source.signal);
        expect(taskSignal).toBe(task.signal);
        expect(() => getAbortSignal()).toThrow("outside a download operation");
    });

    test("re-enters the context whenever an async iterator advances", async () => {
        const controller = new AbortController();
        async function* signals(): AsyncIterable<AbortSignal> {
            yield getAbortSignal();
            await Promise.resolve();
            yield getAbortSignal();
        }

        const seen: AbortSignal[] = [];
        for await (const signal of iterateWithAbortSignal(controller.signal, signals)) {
            seen.push(signal);
            expect(() => getAbortSignal()).toThrow("outside a download operation");
        }

        expect(seen).toEqual([controller.signal, controller.signal]);
    });
});

describe("createTimedAbortScope", () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    test("forwards cancellation from its parent signal", () => {
        const parent = new AbortController();
        const scope = createTimedAbortScope(60000, parent.signal);

        parent.abort();

        expect(scope.signal.aborted).toBe(true);
        scope.dispose();
    });

    test("aborts when its deadline expires", () => {
        jest.useFakeTimers();
        const scope = createTimedAbortScope(25);

        jest.advanceTimersByTime(25);

        expect(scope.signal.aborted).toBe(true);
        scope.dispose();
    });

    test("clears its deadline when disposed", () => {
        jest.useFakeTimers();
        const scope = createTimedAbortScope(25);

        scope.dispose();
        jest.advanceTimersByTime(25);

        expect(scope.signal.aborted).toBe(false);
    });
});
