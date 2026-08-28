# Changelog

## Unreleased

### Changed

-   Centralized HLS key acquisition outside the container profiles. Repeated explicit keys now map to distinct
    AES-128 key URIs in first-seen order within each Media Playlist and retain those assignments across live
    refreshes, while one explicit key continues to apply to every URI. Multiple fMP4 SAMPLE-AES keys continue to use
    KID selectors.
-   Centralized download-side key materialization while retaining session preflight validation before task attempts
    and final algorithm validation inside each encryption handler.

## 6.0.0-beta.4 - 2026-08-25

### Changed

-   Accepted opaque and parallel DRM `KEYFORMAT` metadata for `SAMPLE-AES` HLS while continuing to use only explicit
    raw decryption keys. Missing keys now report that the content is protected before media downloads begin.

## 6.0.0-beta.3 - 2026-08-23

### Breaking changes

-   Changed `HLSSourceOptions.explicitKeys`, `ArchiveDownloaderConfig.explicitKeys`, and `LiveDownloaderConfig.explicitKeys` from strings to structured `HLSExplicitKey` values. The CLI continues to accept `key` and now also parses `kid:key`, retaining the optional KID for future per-key selection without changing current adapter resolution. Multiple CLI keys now require repeated `--key` options; comma-separated values are no longer expanded.

### Changed

-   Removed legacy Hibiki and YouTube site-specific behavior. Abema segment filtering now also applies to refreshed live playlists.
-   Added an optional per-track source container override so mixed-container HLS renditions retain accurate file extensions without breaking existing custom sources.
-   Centralized HLS profile selection and distinguish MPEG-TS `EXT-X-MAP` PAT/PMT initialization sections from fMP4 `ftyp`/`moov` initialization sections instead of treating every map as fMP4.
-   Replaced the legacy Windows registry wrapper so automatic system-proxy discovery no longer triggers Node.js `DEP0190` warnings.

### Added

-   Added fMP4/CMAF `SAMPLE-AES` support with progressive output. Bento4 `mp4decrypt` is required.
-   Added HLS Packed AAC `SAMPLE-AES` decryption, preserving timed ID3 metadata while decrypting ADTS frames and supporting mixed MPEG-TS video plus AAC audio renditions.

## 6.0.0-beta.2 - 2026-08-14

### Added

-   Added MPEG-TS SAMPLE-AES decryption for H.264, AAC, AC-3, and E-AC-3.

## 6.0.0-beta.1 - 2026-08-04

### Breaking changes

-   Replaced the exported `ArchiveDownloader` and `LiveDownloader` classes with the `createArchiveDownloader()` and `createLiveDownloader()` controller factories. Downloads now expose state through `getSnapshot()`, `download()` promises resolve after the full lifecycle completes, and live downloads use `stop()` instead of `stopDownload()`.
-   Removed archive download resumption, including the `resume` CLI command and `ArchiveDownloader.resume()`.
-   Removed built-in NicoVideo and NicoLive download support.
-   Archive and live downloads now both drop a chunk after reaching the user-configured retry limit; archive downloads no longer retry ordinary failed chunks indefinitely.
-   Changed the `chunk-downloaded` event payload. The 5.x `taskname`, `finishedChunksCount`, `totalChunksCount`, `chunkSpeed`, `ratioSpeed`, and `eta` fields were replaced by `taskName`, `trackId`, `completedChunkCount`, `successfulChunkCount`, `droppedChunkCount`, `totalChunkCount`, `successfulChunksPerSecond`, `successfulDurationRatio`, and `completionEta`.
-   Changed `--slice` selection from the 5.x segment-start rule to segment overlap with a half-open `[start, end)` range. Segments spanning `start` are now included, while segments starting exactly at `end` are excluded, so boundary segments and output duration may differ.
-   Removed the `--chunk-naming-strategy` CLI option and the corresponding `chunkNamingStrategy` library configuration. Temporary HLS chunks now use the mixed `sequence_upstream-name` format.
-   Published the package as ESM-only bundles. CommonJS `require()` and internal `dist/` module paths are no longer supported.
-   Raised the minimum supported Node.js version to 24.
-   Changed the default parent directory for temporary workspaces from the system temporary directory to the current working directory.
-   Removed the `--clean` CLI command. Temporary workspaces that cannot be deleted automatically must now be removed manually.
-   Removed the `--format` CLI option and `DownloaderConfig.format`. `--output` / `DownloaderConfig.output` is now an output basename: a recognized video extension is discarded, and the actual output extension is selected from the source or muxer container.
-   Changed explicit-key handling in the common HLS adapter. `--key` and `HLSSourceOptions.explicitKeys` now accept at most one key for this adapter; when supplied, that key is used for every key URI and remote key downloads are skipped. Site-specific HLS adapters retain their own key handling.

### Added

-   Added interactive video and audio selection for HLS master playlists. Choices show available resolution, frame rate, codec, bandwidth, language, and channel information, and the playlist's default audio rendition is preselected. Downloads start immediately when there is no choice to make; non-interactive terminals automatically use all tracks from the highest-bandwidth option.
-   Added downloading of external HLS audio renditions and audio-only variants. Selected tracks are downloaded independently with separate progress, and remain as separate output files when they cannot be muxed.
-   Added automatic muxing of separate video and audio tracks. Minyami uses `mkvmerge` when available and falls back to FFmpeg.
-   Added end-to-end HLS byte-range downloads for `EXT-X-BYTERANGE` media segments and `EXT-X-MAP:BYTERANGE` initialization sections. Custom download sources can also publish an optional byte range on each item.

### Changed

-   CLI completion and ETA now count both successful and dropped chunks, while speed and downloaded-duration figures count only successful chunks. Progress output reports successful and dropped counts separately.
-   Improved compatibility with HLS playlists containing blank or comment lines and AES-128 encryption metadata.
-   Non-debug error logs now include the underlying error message when available.
-   HLS tracks kept without audio/video muxing use `.ts`. If neither muxer is available, separate track files are retained; `mkvmerge` produces `.mkv`, while FFmpeg produces `.mp4` with `faststart`. Successful muxing removes the intermediate track files.
