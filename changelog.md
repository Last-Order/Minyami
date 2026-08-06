# Changelog

## 6.0.0-beta.1 - 2026-08-04

### Breaking changes

-   Replaced the stateful archive and live downloader classes with factory-created controllers.
-   Changed download lifecycle methods to return promises and exposed explicit runtime snapshots and live stop control.
-   Removed the Nico archive/live parsers, Nico-specific channel handling, and all Nico-only task grouping and persistence mechanisms.
-   Removed archive task resume, the `resume` CLI command and controller API, and task-state persistence for both archive and live downloads.
-   Archive and live downloads now both drop a chunk after reaching the user-configured retry limit; archive downloads no longer retry ordinary failed chunks indefinitely.
-   Replaced ambiguous finished-chunk progress fields with explicit completed, successful, dropped, and successful-duration metrics in snapshots and chunk event payloads.
-   Changed `--slice` selection to use segment overlap with a half-open `[start, end)` range. A segment is selected when its end is after `start` and its start is before `end`. Unlike 5.x, a segment ending exactly at `start` and a segment starting exactly at `end` are excluded; boundary segments and resulting output duration may therefore differ from previous releases.
-   Removed the `--chunk-naming-strategy` CLI option, the `DownloaderConfig.chunkNamingStrategy` API, and the `NamingStrategy` enum. General-purpose chunks now always use the mixed `sequence_upstream-name` format; source-specific internal naming remains available to site adapters.
-   Replaced the HLS-shaped `DownloadItem.chunk` and `DownloadTask.chunk` fields with a protocol-neutral `DownloadItem`; runtime tasks now expose the immutable item through `DownloadTask.item`. Renamed source metadata fields from `chunkNamer`/`chunkTimeout` to `itemNamer`/`itemTimeout`.
-   Raised the minimum supported Node.js version to 22.

### Added

-   Added isolated download runtimes for configuration, HTTP sessions, item execution, progress tracking, and output coordination.
-   Added a shared task scheduler with concurrency control and retry handling.
-   Added a `DownloadSource` abstraction, a configurable `HLSSource`, and a shared `createDownloader` execution engine for custom task sources.
-   Added automated coverage for archive, live, custom-source, encrypted, scheduler, progress, HTTP-isolation, retry, and failure flows.

### Changed

-   Parser integrations now return declarative download plans instead of mutating global downloader state.
-   Archive and live factories now use the same downloader lifecycle; their HLS sources differ only in snapshot versus follow discovery mode.
-   HLS sources now translate parser chunks into protocol-neutral download items and fully resolve duration, initialization, encryption-key, and IV semantics before scheduling.
-   Replaced the single smoke-test script with a modular TypeScript test suite powered by Jest and organized by source module.
-   HTTP headers, cookies, and proxy configuration are isolated per downloader instance.
-   Archive downloads continue to delete chunks after they are written to merged output unless `keep` is enabled.
-   Builds now clean `dist` before compiling so removed modules cannot remain in release artifacts.

### Removed

-   Removed Nico parser modules, Nico live transport code, Nico-only APIs and types, and the obsolete WebSocket dependencies they required.

### Fixed

-   Fixed completed archive and live snapshots reporting pending tasks.
