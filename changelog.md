# Changelog

## 6.0.0-beta.1 - 2026-08-04

### Breaking changes

-   Replaced the stateful archive and live downloader classes with factory-created controllers. Download lifecycle methods now return promises, and controllers expose explicit runtime snapshots and live stop control.
-   Removed archive task resume, the `resume` CLI command and controller API, and task-state persistence for both archive and live downloads.
-   Removed the Nico archive/live parsers, channel handling, task grouping and persistence mechanisms, related APIs and types, and obsolete WebSocket dependencies.
-   Archive and live downloads now both drop a chunk after reaching the user-configured retry limit; archive downloads no longer retry ordinary failed chunks indefinitely.
-   Replaced ambiguous finished-chunk progress fields with explicit completed, successful, dropped, and successful-duration metrics in snapshots and chunk event payloads.
-   Changed `--slice` selection to use segment overlap with a half-open `[start, end)` range. A segment is selected when its end is after `start` and its start is before `end`. Unlike 5.x, a segment ending exactly at `start` and a segment starting exactly at `end` are excluded; boundary segments and resulting output duration may therefore differ from previous releases.
-   Removed the `--chunk-naming-strategy` CLI option, the `DownloaderConfig.chunkNamingStrategy` API, and the `NamingStrategy` enum. General-purpose chunks now always use the mixed `sequence_upstream-name` format; source-specific internal naming remains available to site adapters.
-   Replaced the HLS-shaped `DownloadItem.chunk` and `DownloadTask.chunk` fields with a protocol-neutral `DownloadItem`; runtime tasks now expose the immutable item through `DownloadTask.item`. Renamed source metadata fields from `chunkNamer`/`chunkTimeout` to `itemNamer`/`itemTimeout`.
-   Raised the minimum supported Node.js version to 22.
-   Changed the default parent directory for `minyami_<timestamp>_<random>` temporary workspaces from the system temporary directory to the current working directory. The workspace and temporary-file naming strategies are unchanged.
-   Removed the `--clean` CLI command. Temporary workspaces that cannot be deleted automatically must now be removed manually.

### Added

-   Added a `DownloadSource` abstraction, a configurable `HLSSource`, and a shared `createDownloader` execution engine for custom task sources.
-   Added isolated per-download runtimes and a shared task scheduler for item execution, concurrency, retries, progress tracking, and output coordination.

### Changed

-   Unified archive and live downloads on the same downloader lifecycle. Parser integrations now return declarative plans, while HLS sources translate parser chunks into protocol-neutral items and resolve duration, initialization, encryption-key, and IV semantics before scheduling.
-   Archive and live HLS sources now differ only in snapshot versus follow discovery mode.
-   HTTP headers, cookies, and proxy configuration are isolated per downloader instance.
-   Builds now clean `dist` before compiling so removed modules cannot remain in release artifacts.

### Fixed

-   Fixed completed archive and live snapshots reporting pending tasks.
