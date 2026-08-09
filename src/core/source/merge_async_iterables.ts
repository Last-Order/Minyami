type PendingResult<T> =
    | { readonly index: number; readonly status: "fulfilled"; readonly result: IteratorResult<T> }
    | { readonly index: number; readonly status: "rejected"; readonly error: unknown };

/**
 * Fairly fans in async iterables with at most one pending value per producer.
 * Producer order is preserved independently while consumers see values as soon as they are ready.
 */
export async function* mergeAsyncIterables<T>(
    sources: readonly AsyncIterable<T>[],
    onClose?: () => void
): AsyncIterable<T> {
    const iterators = sources.map((source) => source[Symbol.asyncIterator]());
    const pending = new Map<number, Promise<PendingResult<T>>>();
    const requestNext = (index: number): void => {
        pending.set(
            index,
            iterators[index].next().then(
                (result) => ({ index, status: "fulfilled", result }),
                (error) => ({ index, status: "rejected", error })
            )
        );
    };

    iterators.forEach((_iterator, index) => requestNext(index));
    try {
        while (pending.size > 0) {
            const settled = await Promise.race(pending.values());
            pending.delete(settled.index);
            if (settled.status === "rejected") {
                throw settled.error;
            }
            if (!settled.result.done) {
                yield settled.result.value;
                requestNext(settled.index);
            }
        }
    } finally {
        onClose?.();
        await Promise.all(iterators.map((iterator) => Promise.resolve(iterator.return?.()).catch(() => undefined)));
    }
}
