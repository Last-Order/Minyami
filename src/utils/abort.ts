import { AsyncLocalStorage } from "node:async_hooks";

export interface AbortSignalLike {
    readonly aborted: boolean;
    addEventListener?: (...args: any[]) => any;
    removeEventListener?: (...args: any[]) => any;
}

export interface TimedAbortScope {
    readonly signal: AbortSignal;
    dispose(): void;
}

const abortSignalStorage = new AsyncLocalStorage<AbortSignal>();

/** Runs one async branch with its cancellation signal available to every descendant operation. */
export function runWithAbortSignal<T>(signal: AbortSignal, operation: () => T): T {
    return abortSignalStorage.run(signal, operation);
}

/**
 * Re-enters the signal context for every iterator operation because creating an
 * async iterable does not execute its body or retain the caller's ALS store.
 */
export async function* iterateWithAbortSignal<T>(
    signal: AbortSignal,
    createIterable: () => AsyncIterable<T>
): AsyncIterable<T> {
    const iterator = runWithAbortSignal(signal, () => createIterable()[Symbol.asyncIterator]());
    try {
        while (true) {
            const result = await runWithAbortSignal(signal, () => iterator.next());
            if (result.done) {
                return;
            }
            yield result.value;
        }
    } finally {
        await runWithAbortSignal(signal, () => iterator.return?.());
    }
}

/** Returns the signal owned by the current source or task branch. */
export function getAbortSignal(): AbortSignal {
    const signal = getOptionalAbortSignal();
    if (!signal) {
        throw new Error("AbortSignal is unavailable outside a download operation.");
    }
    return signal;
}

/** Allows low-level utilities to preserve standalone use when no download branch owns them. */
export function getOptionalAbortSignal(): AbortSignal | undefined {
    return abortSignalStorage.getStore();
}

/** Combines an upstream cancellation with a deadline because Axios accepts only one signal per request. */
export function createTimedAbortScope(timeout: number, parent?: AbortSignalLike): TimedAbortScope {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeoutId = setTimeout(abort, timeout);

    parent?.addEventListener?.("abort", abort, { once: true });
    // Recheck after subscribing so an abort racing listener registration cannot be missed.
    if (parent?.aborted) {
        abort();
    }

    return {
        signal: controller.signal,
        dispose() {
            clearTimeout(timeoutId);
            parent?.removeEventListener?.("abort", abort);
        },
    };
}
