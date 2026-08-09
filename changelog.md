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
-   Changed `DownloadSource.prepare()` metadata to declare one or more discriminated video/audio tracks and made every `SourceBatch` identify one declared track. `DownloadTask` now exposes both a global discovery id and a track-local merge index; item namers receive both through `DownloadItemNamingContext`.
-   Replaced snapshot `outputPath` with `outputBasePath`, flattened final `outputPaths`, and per-track snapshots. Top-level `sourcePath` now remains the original source entry point instead of changing to a selected HLS variant URL.
-   Raised the minimum supported Node.js version to 22.
-   Changed the default parent directory for `minyami_<timestamp>_<random>` temporary workspaces from the system temporary directory to the current working directory. The workspace and temporary-file naming strategies are unchanged.
-   Removed the `--clean` CLI command. Temporary workspaces that cannot be deleted automatically must now be removed manually.
-   Replaced `variantSelector`, `HLSVariantSelector`, and the public `HLSVariant` model with the protocol-neutral `streamSelector`, `StreamSelector`, and `MediaTrack` models. A selector now receives a `StreamCatalog` and returns a non-empty subset of canonical tracks from one compatible `StreamOption`, or `undefined` to cancel.

### Added

-   Added a `DownloadSource` abstraction, a configurable `HLSSource`, and a shared `createDownloader` execution engine for custom task sources.
-   Added public protocol-neutral `StreamCatalog`, `StreamOption`, `MediaTrack`, and `TrackSelection` models for archive, live, and direct source consumers.
-   Added protocol-neutral multi-track scheduling with independent temporary directories, progress, dropped-item gaps, and output concentration for every declared track.

### Changed

-   HLS master playlists now expose external `EXT-X-MEDIA` audio renditions to stream selectors and download selected renditions as independent track outputs. URI-less embedded audio remains in the primary output.
-   CLI downloads of master playlists with multiple compatible options now open an interactive terminal selector. Non-TTY CLI usage and library defaults select every track in the highest-bandwidth option.
-   HTTP headers, cookies, and proxy configuration are isolated per downloader instance.

### Fixed

-   Fixed completed archive and live snapshots reporting pending tasks.
