# Changelog

## 6.0.0-beta.1 - 2026-08-04

### Breaking changes

-   Replaced the stateful archive and live downloader classes with factory-created controllers.
-   Changed download lifecycle methods to return promises and exposed explicit runtime snapshots and live stop control.
-   Removed the Nico archive/live parsers, Nico-specific channel handling, and all Nico-only task grouping and persistence mechanisms.
-   Removed archive task resume, the `resume` CLI command and controller API, and task-state persistence for both archive and live downloads.
-   Changed `--slice` selection to use segment overlap with a half-open `[start, end)` range. A segment is selected when its end is after `start` and its start is before `end`. Unlike 5.x, a segment ending exactly at `start` and a segment starting exactly at `end` are excluded; boundary segments and resulting output duration may therefore differ from previous releases.

### Added

-   Added isolated download runtimes for configuration, HTTP sessions, playlist loading, key resolution, chunk execution, progress tracking, and output coordination.
-   Added a shared task scheduler with concurrency control and retry handling.
-   Added smoke coverage for archive, live, encrypted, scheduler, HTTP-isolation, and failure flows.

### Changed

-   Parser integrations now return declarative download plans instead of mutating global downloader state.
-   HTTP headers, cookies, and proxy configuration are isolated per downloader instance.
-   Archive downloads continue to delete chunks after they are written to merged output unless `keep` is enabled.
-   Builds now clean `dist` before compiling so removed modules cannot remain in release artifacts.

### Removed

-   Removed Nico parser modules, Nico live transport code, Nico-only APIs and types, and the obsolete WebSocket dependencies they required.

### Fixed

-   Fixed completed archive and live snapshots reporting pending tasks.
