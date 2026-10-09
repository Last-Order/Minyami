# Minyami Architecture and Contributor Guide

## Scope and priorities

- These instructions apply to the entire repository.
- The supported runtime is Node.js 24 or newer. The package is ESM-only, uses strict TypeScript, and is built with `tsdown`.
- Use npm and keep `npm-shrinkwrap.json` authoritative. Change the shrinkwrap only when dependencies actually change.
- Keep this guide focused on module boundaries, ownership, dependency direction, and contribution practices. Document concrete behavior in the usage documentation, module-local comments, and tests.

## Project map

- `src/index.ts`: CLI entry point and CLI-to-core adaptation.
- `src/exports.ts`: the public package surface. Treat exports and exported type shapes here as compatibility-sensitive.
- `src/core/archive.ts` and `src/core/live.ts`: HLS compatibility factories over the shared downloader.
- `src/core/source/`: protocol-neutral source contracts, stream selection, and async-source composition.
- `src/core/source/hls/`: HLS implementation, including parsers, playlist planning, cursors, and site adapters.
- `src/core/download/`: shared session orchestration, manifest, scheduler, task execution, encryption handlers, and output management.
- `src/core/muxer/` and `src/core/media_container.ts`: muxer integration and media-container abstractions.
- `src/utils/`: CLI/platform support such as logging, proxy discovery, abort deadlines, config loading, and time parsing.
- `test/`: mirrors the source boundaries. Reusable local HTTP-server and temporary-filesystem fixtures belong in `test/helpers/`.
- `dist/` and `coverage/`: generated outputs; never hand-edit or commit them.

## Runtime architecture

The shared pipeline is:

`DownloadSource.prepare()` -> `DownloadSource.discover()` -> `DownloadManifest` -> `TaskScheduler` -> `ChunkExecutor` -> per-track `FileConcentrator` -> optional `Muxer`

Keep orchestration in the shared downloader and protocol-specific work behind source contracts.

### Session ownership

- `DownloadSession` owns pipeline orchestration and session-wide lifecycle decisions. Collaborators own only the state needed for their assigned responsibilities.
- Keep `createDownloader()` as the shared lifecycle entry point. Keep `createArchiveDownloader()` and `createLiveDownloader()` as thin compatibility factories rather than separate downloader implementations.
- Discovery and task execution have separate cancellation scopes managed by the session. Protocol sources must not control task execution or finalization.
- Public event listeners are observers, not participants in internal task commits or session control flow.

### Source contracts and dependency direction

- A `DownloadSource` owns upstream interaction, parsing, protocol-specific discovery state, and conversion into protocol-neutral work.
- Keep `DownloadItem`, `SourceBatch`, `SourceTrack`, media-track descriptors, and stream catalogs immutable across module boundaries.
- `DownloadSourceContext` exposes narrow source HTTP and shared key-store capabilities. Do not expose session internals or raw downloader configuration to a protocol implementation.
- Sources publish metadata and work through source contracts. Task identity, scheduling, progress accounting, filesystem management, output, and muxing belong to the shared downloader.
- Code under `src/core/download/` may depend on protocol-neutral source contracts, but must not import HLS parsers, `HLSSegment`, playlist models, or site adapters.

### HLS and stream selection

- Keep HLS parsing, playlist planning, protocol locators, and encryption-context resolution inside `src/core/source/hls/`.
- `HLSMediaPlaylistCursor` encapsulates state belonging to one media playlist. Do not share playlist-specific cursor state between renditions.
- Stream selectors consume protocol-neutral `StreamCatalog` descriptors. Keep protocol locators in private source plans rather than selector-facing types.
- Site-specific extensions belong in `src/core/source/hls/adapters/` and remain within the source boundary.
- Archive and live sources compose the same shared scheduling, execution, output, and muxing components.

### Task execution and accounting

- `DownloadManifest` owns task identity, discovery order, track indexing, and progress accounting.
- `TaskScheduler` owns queued work and concurrency coordination. Keep protocol interpretation and filesystem output outside the scheduler.
- `ChunkExecutor` owns per-task I/O and invokes encryption handlers through protocol-neutral descriptors. It must not derive protocol defaults.
- Keep source HTTP request policy and download-task execution policy in separate abstractions.
- Encryption handlers own algorithm-specific validation and file transformation. Shared key storage, execution policy, and output management remain separate responsibilities.

### Output and muxing

- The shared downloader owns temporary workspaces, filesystem-path validation, and output-resource management. Source-provided metadata does not transfer that ownership to the source.
- Each track has an independent `FileConcentrator` and output workspace. Keep ordered writing separate from concurrent task execution.
- Muxers integrate external media tools behind the `Muxer` abstraction. Keep tool-specific details outside source discovery and task scheduling.
- Keep media-container and output-path decisions in the shared output layer rather than protocol parsers or CLI presentation code.

## Public API and user-facing changes

- `src/exports.ts` is the supported library entry point; internal `dist/` paths and CommonJS `require()` are not supported APIs.
- Keep CLI concerns in `src/index.ts`. Explicitly adapt CLI/config-file values to core options so unknown keys and CLI-only state do not enter the downloader.
- When behavior, options, events, defaults, output naming, or exported types change, update `readme.md`, `readme.zh-cn.md`, and `changelog.md` as applicable. Keep the English and Chinese usage documentation semantically aligned.

## Code and comments

- Follow the repository's strict TypeScript configuration. Prefer explicit domain types, readonly published data, exhaustive state handling, and narrow protocol-neutral interfaces over casts or `any`.
- Formatting is enforced by Prettier: 4-space indentation and a 120-column print width. Avoid unrelated formatting or line-ending churn.
- Add concise comments where ownership, dependency boundaries, or asynchronous coordination are not obvious.
- Comments must explain why a rule exists or state an invariant. Do not merely restate the next line. Update or remove nearby comments whenever behavior changes.

## Testing

- Add or update focused Jest coverage when changing module contracts or runtime behavior.
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
