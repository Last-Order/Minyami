# Project Constraints

## Download architecture

- Keep task discovery and task execution separate. A `DownloadSource` owns upstream loading, parsing, refresh, filtering, deduplication, and end-of-source detection. It must not own task ids, filenames, retries, scheduler state, progress, merging, or temporary files.
- Sources yield protocol-neutral, immutable `DownloadItem` values through `SourceBatch`. The shared downloader wraps each item in a `DownloadTask` and assigns monotonically increasing ids in discovery order.
- Keep protocol models inside their source boundary. Files under `src/core/download` must not import `M3U8Chunk`, `m3u8`, or HLS parser modules; `HLSSource` must resolve HLS-specific kind, duration, encryption key identity, and IV rules before yielding an item.
- Use the shared `createDownloader` lifecycle for every source. Do not create separate archive/live downloader implementations; model one-shot inputs as finite sources and live inputs as continuous sources.
- An encrypted `DownloadItem` must contain a complete supported encryption descriptor. Its `keyId` must already exist in the shared key store before the item is yielded; HLS sources use the absolute key URL as this identity.
- Keep the scheduler open while a source is discovering work. Close it only after discovery ends or graceful cancellation is observed, then drain already queued/running tasks before merging.
- Graceful stop cancels further discovery and drains known tasks. Hard stop may abort queued tasks. Do not conflate these two lifecycle paths.
- Preserve `createArchiveDownloader` and `createLiveDownloader` as compatibility wrappers unless an explicit public API break is requested.

## Comments

- Add concise comments around architectural boundaries, asynchronous lifecycle transitions, ordering requirements, cancellation behavior, deduplication rules, and encryption context.
- Comments must explain why a rule exists or state an invariant; do not merely restate the next line of code.
- Update or remove nearby comments whenever behavior changes so comments cannot drift from the implementation.

## Verification

- Mirror source-module boundaries under `test/` and keep shared servers/filesystem fixtures under `test/helpers/`. Do not accumulate unrelated behavior in a single end-to-end test file.
- Tests should demonstrate supported behavior and observable results. Do not add source-text scans or tests whose sole purpose is proving that an API, dependency, or generated file is absent; keep those prohibitions in project constraints and review instead.
- Add focused Jest coverage when introducing a source or changing discovery, cancellation, ordering, retry, encryption, progress, or merge behavior.
- Before handing off changes, run `npm test`, `npm run build`, `npm run lint`, and `git diff --check`.
