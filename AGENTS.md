# Minyami Contributor Guide

## Scope and priorities

- These instructions apply to the entire repository.
- Minyami is a maintenance-mode Node.js HLS downloader. Prefer the smallest compatible fix that preserves existing CLI and library behavior. Do not broaden product scope or break public APIs unless the request explicitly requires it.
- The supported runtime is Node.js 24 or newer. The package is ESM-only, uses strict TypeScript, and is built with `tsdown`.
- Use npm and keep `npm-shrinkwrap.json` authoritative. Change the shrinkwrap only when dependencies actually change.

## Project map

- `src/index.ts`: CLI entry point. It parses CLI/config-file values, configures proxy behavior, adapts CLI options to the core API, installs signal handling, and reports progress.
- `src/exports.ts`: the public package surface. Treat exports and exported type shapes here as compatibility-sensitive.
- `src/core/archive.ts` and `src/core/live.ts`: HLS compatibility factories over the shared downloader. Archive uses a snapshot source; live uses a following source.
- `src/core/source/`: protocol-neutral source contracts, stream selection, and async-source composition.
- `src/core/source/hls/`: the complete HLS boundary: parsing, playlist loading, master-playlist planning, per-media-playlist cursors, refresh/deduplication, slicing, key resolution, and site adapters.
- `src/core/download/`: protocol-neutral lifecycle, scheduling, retries, HTTP execution, encryption handlers, progress/accounting, ordered output, and finalization.
- `src/core/muxer/` and `src/core/media_container.ts`: optional cross-track muxing and container/output-path policy.
- `src/utils/`: CLI/platform support such as logging, proxy discovery, abort deadlines, config loading, and time parsing.
- `test/`: mirrors the source boundaries. Reusable local HTTP-server and temporary-filesystem fixtures belong in `test/helpers/`.
- `dist/` and `coverage/`: generated outputs; never hand-edit or commit them.

## Runtime architecture

The shared pipeline is:

`DownloadSource.prepare()` -> `DownloadSource.discover()` -> `DownloadManifest` -> `TaskScheduler` -> `ChunkExecutor` -> per-track `FileConcentrator` -> optional `Muxer`

`DownloadSession` is the sole owner of this pipeline's mutable lifecycle. Keep the following boundaries intact.

### Source discovery

- A `DownloadSource` owns upstream loading, parsing, refresh, filtering, deduplication, stream-end detection, and conversion into protocol-neutral work.
- `prepare()` runs once before discovery. It either returns normal metadata with the complete, ordered track set and source container, or `{ cancelled: true }` for a non-error user selection cancellation.
- `discover()` yields `SourceBatch` values and ends naturally when no more work can arrive or promptly when its discovery signal is cancelled. `continuous` changes progress semantics; iterator exhaustion still defines the end of discovery.
- Treat `DownloadItem`, `SourceBatch`, `SourceTrack`, media-track descriptors, and stream catalogs as immutable values after publication.
- A source must not own task ids, per-track task indices, filenames, retry counters, scheduler state, progress, temporary files, ordered writes, or muxing. Those are shared-downloader responsibilities.
- Sources receive only the retrying source HTTP facade and shared key-store capability through `DownloadSourceContext`. Do not expose session internals or raw downloader configuration to a protocol implementation.
- Keep protocol models inside their source boundary. Code under `src/core/download/` may depend on protocol-neutral source contracts, but must not import HLS parsers, `HLSSegment`, playlist models, or site adapters.

### Stream and HLS boundaries

- Stream selectors receive a frozen, protocol-neutral `StreamCatalog`. They may return a non-empty subset of one compatible option, using the exact canonical track objects offered by the catalog, or `undefined` to cancel normally.
- Keep playlist URLs and other protocol locators in the private HLS plan; do not leak them into selector-facing track descriptors.
- A selected HLS media playlist owns one independent `HLSMediaPlaylistCursor`. Sequence ids, initialization-segment identities, refresh state, and deduplication are playlist-local, including for multiple renditions selected from one master playlist.
- Snapshot and follow modes are source behaviors over the same downloader. Do not create separate archive/live schedulers, executors, output sessions, or merge implementations.
- Apply HLS slicing by media-segment overlap with the half-open `[start, end)` range. Preserve required initialization items for selected media.
- Site-specific behavior belongs in `src/core/source/hls/adapters/`. An adapter may alter segments, resolve keys, or provide an item namer, but it must not take over downloader lifecycle responsibilities.

### Task identity, scheduling, and progress

- `DownloadManifest` is authoritative for discovery order and progress. It assigns monotonically increasing global task ids in source-yield order and monotonically increasing `trackIndex` values within each track.
- Register tracks exactly once before emitting `parsed`. Track order remains stable in snapshots, artifacts, and flattened output paths. Track ids must remain filesystem-safe and unique case-insensitively.
- A source-provided item namer may choose only a filename inside the downloader-owned track directory. Reject absolute paths, separators, `.`/`..`, empty names, and other attempts to escape that directory.
- Keep source-request attempts and download-task attempts as separate policies. The CLI may map its single `--retries` option to both, but the core must not merge the two budgets.
- Keep the scheduler open while discovery may publish more batches. Close it only after discovery ends or graceful cancellation is observed, then drain every queued/running task. A closed scheduler accepts no new work.
- A task has exactly one terminal outcome: successful output admission or an explicit drop after its task-attempt budget. Missing outcomes and duplicate commits are lifecycle errors, not implicit drops or retry opportunities.
- Commit successful output before incrementing manifest progress. Commit failures are fatal; never retry a successfully executed task merely because its commit callback failed.
- Public event listeners are observers. Synchronous throws and rejected listener promises must remain isolated from task commits and session completion. Publish terminal state before emitting `finished` so callbacks see a stable snapshot.

### Cancellation lifecycle

- `stop()` is graceful: cancel further source discovery, keep accepted task I/O alive, close the scheduler after discovery unwinds, drain known work, and finalize normally.
- `abort()` is hard: cancel discovery and active task I/O, discard queued work, stop output admission, preserve recoverable temporary data, and end with status `aborted`.
- Use separate abort signals for discovery and task execution. Never make graceful stop abort accepted downloads.
- Finalization after a normal drain is non-cancellable. It must publish one stable result from the terminal task set.
- Keep `download()` single-use and keep `createDownloader()` as the shared lifecycle. Preserve `createArchiveDownloader()` and `createLiveDownloader()` as public compatibility wrappers unless an explicit API break is requested.

### Encryption

- An encrypted `DownloadItem` must carry a complete, supported, protocol-neutral descriptor before it is yielded. Executors must not derive protocol defaults.
- `keyId` is a stable shared-key-store identity and must already be registered before the item is yielded. HLS uses the absolute key URL as the identity.
- HLS resolves AES-128 kind, key identity, and IV rules inside the HLS boundary. For media with no explicit IV, derive it from the media sequence there; encrypted initialization segments require an explicit IV.
- Validate the handler, key, and descriptor before consuming a task execution attempt. Encryption handlers own algorithm validation and atomic file transformation only; downloading, retries, naming, cleanup policy, and output admission remain outside them.
- Do not replace or delete the encrypted input until decryption has successfully published a complete plaintext file. Respect `keepEncryptedChunks` independently from merge policy.

### Ordered output and muxing

- Each track has its own temporary directory and ordered `FileConcentrator`. Concurrent task completion must never change discovery/track order in the resulting media.
- The concentrator may consume only the longest contiguous prefix of terminal outcomes. Buffer later results until every preceding index is ready or explicitly dropped.
- A dropped item creates a gap only in its own track. After written data, the next successful run starts a new output file; leading/trailing drops must not create empty files.
- Output admission is non-blocking with respect to download workers. Stream/backpressure failures surface at finalization and are session-fatal, not task retries.
- Delete a temporary chunk only after every write sourced from it completes. On hard abort or output failure, prefer preserving recoverable inputs and partial outputs.
- Treat configured output as a basename. The source container determines independently concentrated track extensions; a successful muxer's container determines the cross-track output extension. Never overwrite an existing output path.
- Cross-track muxing is allowed only when retained artifacts contain both audio and video and every track has exactly one output file. Split tracks remain separate because timing across gaps is ambiguous.
- Default muxer priority is `mkvmerge`, then `ffmpeg`. Run binaries directly with argument arrays, never through a shell. On mux failure, remove the incomplete mux target and retain per-track artifacts. After verified mux success, intermediate track cleanup may proceed without invalidating the muxed result.
- `noMerge` intentionally leaves chunks in the temporary workspace. Cleanup may remove only directories proven empty; never guess that retained files are disposable.

## Public API and user-facing changes

- `src/exports.ts` is the supported library entry point; internal `dist/` paths and CommonJS `require()` are not supported APIs.
- Keep CLI concerns in `src/index.ts`. Explicitly adapt CLI/config-file values to core options so unknown keys and CLI-only state do not enter the downloader.
- When behavior, options, events, defaults, output naming, or exported types change, update `readme.md`, `readme.zh-cn.md`, and `changelog.md` as applicable. Keep the English and Chinese usage documentation semantically aligned.
- Preserve observable event meanings: `downloaded` means all accepted tasks are terminal, while `finished` means the session has reached a stable finished or aborted state.

## Code and comments

- Follow the repository's strict TypeScript configuration. Prefer explicit domain types, readonly published data, exhaustive state handling, and narrow protocol-neutral interfaces over casts or `any`.
- Formatting is enforced by Prettier: 4-space indentation and a 120-column print width. Avoid unrelated formatting or line-ending churn.
- Add concise comments around architectural boundaries, asynchronous state transitions, ordering, cancellation, deduplication, encryption context, atomic publication, and cleanup safety.
- Comments must explain why a rule exists or state an invariant. Do not merely restate the next line. Update or remove nearby comments whenever behavior changes.

## Testing

- Add or update focused Jest coverage for any change to discovery, parsing, selection, cancellation, ordering, retries, encryption, progress/events, filesystem output, muxing, or proxy/HTTP behavior.
- Mirror source-module boundaries under `test/`. Keep reusable servers and filesystem setup in `test/helpers/`; use local servers and isolated temporary directories rather than external network or shared filesystem state.
- Prefer observable behavior and stable state over private implementation details. Do not add source-text scans or tests whose sole purpose is proving that an API, dependency, or generated file is absent; document prohibitions here and enforce them in review.
- Jest tests run through `ts-jest` as CommonJS while the package output is ESM. Preserve the explicit Jest transform exception for the ESM-only proxy stack when changing proxy dependencies or test configuration.

## Verification

Run focused tests while iterating, then run the full repository gate before handoff:

```shell
npm test
npm run typecheck
npm run build
npm run lint
git diff --check
```

For changes to package entry points, build configuration, or the CLI, also run the CI smoke checks:

```shell
node ./dist/index.mjs --version
node --input-type=module -e "const api = await import('minyami'); if (typeof api.createDownloader !== 'function') throw new Error('ESM package entry is invalid')"
```

Report any command that could not be run and why. Do not claim verification from stale `dist/` or `coverage/` artifacts.
