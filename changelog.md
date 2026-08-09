# Changelog

## 6.0.0-beta.1 - 2026-08-04

Breaking changes are measured from v5.5.1. Intermediate APIs used only during 6.0 beta development are omitted.

### Breaking changes

-   Replaced the exported `ArchiveDownloader` and `LiveDownloader` classes with the `createArchiveDownloader()` and `createLiveDownloader()` controller factories. Downloads now expose state through `getSnapshot()`, `download()` promises resolve after the full lifecycle completes, and live downloads use `stop()` instead of `stopDownload()`.
-   Removed archive task resume, including the `resume` CLI command, `ArchiveDownloader.resume()`, and persisted task state. Live task-state persistence was also removed.
-   Removed the Nico archive/live parsers and their channel, task-grouping, persistence, API, type, and WebSocket support.
-   Archive and live downloads now both drop a chunk after reaching the user-configured retry limit; archive downloads no longer retry ordinary failed chunks indefinitely.
-   Changed the `chunk-downloaded` event payload. The 5.x `taskname`, `finishedChunksCount`, `totalChunksCount`, `chunkSpeed`, `ratioSpeed`, and `eta` fields were replaced by `taskName`, `trackId`, `completedChunkCount`, `successfulChunkCount`, `droppedChunkCount`, `totalChunkCount`, `successfulChunksPerSecond`, `successfulDurationRatio`, and `completionEta`.
-   Changed `--slice` selection to use segment overlap with a half-open `[start, end)` range. A segment is selected when its end is after `start` and its start is before `end`. Unlike 5.x, a segment ending exactly at `start` and a segment starting exactly at `end` are excluded; boundary segments and resulting output duration may therefore differ from previous releases.
-   Removed the `--chunk-naming-strategy` CLI option, `DownloaderConfig.chunkNamingStrategy`, and the `NamingStrategy` enum. Built-in HLS sources use the mixed `sequence_upstream-name` format; custom sources can provide an item namer.
-   Raised the minimum supported Node.js version to 22.
-   Changed the default parent directory for `minyami_<timestamp>_<random>` temporary workspaces from the system temporary directory to the current working directory. The workspace and temporary-file naming strategies are unchanged.
-   Removed the `--clean` CLI command. Temporary workspaces that cannot be deleted automatically must now be removed manually.

### Added

-   Added the protocol-neutral `DownloadSource`, `DownloadItem`, `SourceBatch`, and `SourceTrack` extension API, together with a configurable `HLSSource` and shared `createDownloader()` engine for custom sources.
-   Added the protocol-neutral `streamSelector`, `StreamCatalog`, `StreamOption`, `MediaTrack`, and `TrackSelection` APIs. A selector returns one or more canonical video/audio tracks from a compatible stream option, or `undefined` to cancel.
-   Added multi-track downloading with independent temporary directories, ordering, progress, dropped-item gaps, and output concentration for each physical track.
-   Added controller snapshots with per-track state and metadata-preserving `TrackArtifact` outputs. Logical `MediaTrack` identities remain separate from filesystem-safe execution track ids.

### Changed

-   HLS master playlists now expose external `EXT-X-MEDIA` audio renditions to stream selectors and download selected renditions as independent track outputs. URI-less embedded audio remains in the primary output.
-   CLI downloads of master playlists with multiple compatible options now open an interactive terminal selector. Non-TTY CLI usage and library defaults select every track in the highest-bandwidth option.
-   HTTP headers, cookies, and proxy configuration are isolated per downloader instance.
-   Non-debug error logs now include the underlying error message when available.
