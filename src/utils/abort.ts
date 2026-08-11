export interface AbortSignalLike {
    readonly aborted: boolean;
    addEventListener?: (...args: any[]) => any;
    removeEventListener?: (...args: any[]) => any;
}

export interface TimedAbortScope {
    readonly signal: AbortSignal;
    dispose(): void;
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
