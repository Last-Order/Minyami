import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { createTimedAbortScope } from "@/utils/abort";

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
