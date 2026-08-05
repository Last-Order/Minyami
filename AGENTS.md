# Project Constraints

## Download architecture

- Keep task discovery and task execution separate. A `DownloadSource` owns upstream loading, parsing, refresh, filtering, deduplication, and end-of-source detection. It must not own task ids, filenames, retries, scheduler state, progress, merging, or temporary files.
- Sources yield immutable `DownloadItem` values through `SourceBatch`. The shared downloader materializes them into `DownloadTask` values and assigns monotonically increasing ids in discovery order.
- Use the shared `createDownloader` lifecycle for every source. Do not create separate archive/live downloader implementations; model one-shot inputs as finite sources and live inputs as continuous sources.
- An encrypted `DownloadItem` must contain an absolute `encryptionKeyUrl`, and the corresponding key must be registered in the shared key store before the item is yielded.
- Keep the scheduler open while a source is discovering work. Close it only after discovery ends or graceful cancellation is observed, then drain already queued/running tasks before merging.
- Graceful stop cancels further discovery and drains known tasks. Hard stop may abort queued tasks. Do not conflate these two lifecycle paths.
- Preserve `createArchiveDownloader` and `createLiveDownloader` as compatibility wrappers unless an explicit public API break is requested.

## Comments

- Add concise comments around architectural boundaries, asynchronous lifecycle transitions, ordering requirements, cancellation behavior, deduplication rules, and encryption context.
- Comments must explain why a rule exists or state an invariant; do not merely restate the next line of code.
- Update or remove nearby comments whenever behavior changes so comments cannot drift from the implementation.

## Verification

- Add smoke coverage when introducing a new source or changing discovery, cancellation, ordering, retry, encryption, or merge behavior.
- Before handing off changes, run `npm run test:smoke`, `npm run lint`, and `git diff --check`.
