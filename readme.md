# README

[![Build Status](https://github.com/Last-Order/Minyami/workflows/Node%20CI/badge.svg)](https://github.com/Last-Order/Minyami/actions)

[中文说明](readme.zh-cn.md)

> **Deprecation Notice:** Minyami is aging and has entered maintenance mode. No new features will be implemented in the foreseeable future; only bug fixes will be accepted. We recommend using [iori](https://github.com/iori-rs/iori) as an alternative.

## Dependencies

-   mkvmerge (optional, mkv output required)

! Minyami requires Node Active/Maintenance LTS latest or Current latest. Active LTS is recommended. Details [here](https://nodejs.org/en/about/previous-releases).

Make sure you had put the binary files into your system `PATH`.

## Installation

`npm -g i minyami` or `yarn global add minyami`

Please also install the following extension to work with Minyami

1. Install Chrome extension (recommended): https://chrome.google.com/webstore/detail/minyami/cgejkofhdaffiifhcohjdbbheldkiaed (which is also open-sourced [here](https://github.com/Last-Order/Minyami-chrome-extension))

## Usage

```
Help:
     Commands                      Description                   Alias

     --help <command>              Show help documentation       -h
         <command>                 Show help of a specified comma
     --version                     Show version
     --download <input_path>       Download video                -d
         <input_path>              m3u8 file path
         --threads <limit>         Threads limit
             <limit>               (Optional) Limit of threads, defaults to 5
         --retries <limit>         Retry limit
             <limit>               (Optional) Limit of retry times
         --output, o <path>        Output path
             <path>                (Optional) Output file path, defaults to ./output.mkv
         --temp-dir <path>         Temporary file path
             <path>                (Optional) Temporary file path, defaults to env.TEMP
         --key <key>               Set key manually (Internal use)
             <key>                 (Optional) Key for decrypt video.
         --cookies <cookies>       Cookies used to download
             <cookies>
         --headers, H <headers>    HTTP Header used to download
             <headers>             Custom header. eg. "User-Agent: xxxxx". This option will override --cookies.
         --live                    Download live
         --format <format_name>    (Optional) Set output format. default: ts
             <format_name>         Format name. ts or mkv.
         --proxy <proxy-server>    Use the specified HTTP/HTTPS/SOCKS5 proxy
             <proxy-server>        Set proxy in [protocol://<host>:<port>] format. eg. --proxy "http://127.0.0.1:1080".
         --no-proxy                Disable reading proxy configuration from system environment variables or system settings.
         --slice <range>           Download specified part of the stream
             <range>               Set time range in [<hh:mm:ss>-<hh:mm:ss> format]. eg. --slice "45:00-53:00"
         --no-merge                Do not merge m3u8 chunks.
         --keep, k                 Keep temporary files.
         --keep-encrypted-chunks   Do not delete encrypted chunks after decryption.
     --clean                       Clean cache files

Options:

     Options                       Description
     --verbose, debug              Debug output
```

## FAQ

Q: Should I keep the browser open when downloading?

A: It's not necessary.

Q: How to set proxy for Minyami?

A: You can use `--proxy` to set proxy server for Minyami. HTTP/SOCKS5 proxy are supported. Or you can use environment variables `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` to provide proxy configuration for Minyami. And Minyami will read proxy settings from environment variables and Windows system proxy settings. To disable any proxy setting from context, you can add `--disable-proxy` or set `env.NO_PROXY` to and non-empty values.

Q: How to set temporary file location?

A: You can use `--temp-dir` to set the directory of temporary files.

Q: How to set multiple HTTP headers?

A: By providing multiple -H/--headers option. For example, `minyami -d xxxx -H "Cookie: xxxx" --headers "User-Agent: yyy"`.

## Use as a library

Downloaders are created through factory functions. Controllers expose lifecycle operations, events, and read-only
snapshots; internal queues and playlists are not public mutable state.

```TypeScript
import { createArchiveDownloader, createLiveDownloader } from "minyami";

const archive = createArchiveDownloader("https://example.com/archive.m3u8", {
    output: "./archive.ts",
    threads: 8,
});

archive.on("chunk-downloaded", (chunk) => {
    console.log(chunk);
});

await archive.download();
console.log(archive.getSnapshot());

const live = createLiveDownloader("https://example.com/live.m3u8");
setTimeout(() => live.stop(), 60_000);
await live.download();
```

The same execution engine can also consume a source directly. An HLS source in `snapshot` mode yields one batch;
`follow` mode refreshes the playlist and yields newly discovered chunks until the stream ends or the controller is
stopped.

```TypeScript
import { createDownloader, createHLSSource } from "minyami";

const downloader = createDownloader(
    createHLSSource("https://example.com/live.m3u8", { mode: "follow" }),
    { output: "./live.ts" }
);

await downloader.download();
```

Custom implementations of `DownloadSource` may yield any number of `SourceBatch` values. Sources produce immutable
`DownloadItem` values; the downloader owns task ids, filenames, retries, scheduling, progress, and output merging.

### Progress semantics

Snapshots report successful, dropped, and completed work separately:

-   `completedChunkCount`: resolved tasks, equal to `successfulChunkCount + droppedChunkCount`.
-   `successfulChunkCount`: chunks downloaded and processed successfully.
-   `droppedChunkCount`: chunks abandoned after reaching the configured retry limit.
-   `successfulDuration`: total media duration in seconds from successfully processed media chunks; initialization segments and dropped chunks do not add duration.

Completion percentage and ETA use `completedChunkCount`. Download speed and the successful-duration ratio use only
successful chunks.

### Event: `chunk-downloaded`

-   `taskName` `<string>` The filename of the chunk that was just downloaded.
-   `completedChunkCount` `<number>` Successful plus dropped chunks.
-   `successfulChunkCount` `<number>` Successfully processed chunks.
-   `droppedChunkCount` `<number>` Chunks dropped after reaching the retry limit.
-   `totalChunkCount` `<number>` Total archive chunks or live chunks discovered so far.
-   `successfulChunksPerSecond` `<string>` Average successful chunks processed per second.
-   `successfulDurationRatio` `<string>` Successfully processed media duration divided by elapsed wall time.
-   `completionEta` `<string | undefined>` Archive completion ETA; omitted for live downloads.

The `'chunk-downloaded'` event is emitted only after a chunk is downloaded and processed successfully.

### Event: `chunk-error`

-   `error: Error`

The `'chunk-error'` event is emitted when failed to download or decrypt media chunks.

### Event: `downloaded`

The `'downloaded'` event is emitted after every scheduled chunk has either succeeded or been dropped, but before
starting merge.

### Event: `finished`

The `'finished'` event is emitted after all the works are done. CLI program exits after this event is emitted.

### Event: `critical-error`

-   `error: Error`

The `critical-error` is emitted when a error that Minyami can't handle happens.

## Contribution

Minyami is developed with TypeScript. You need to install TypeScript Compiler before you start coding.

**Install development dependencies**

```
npm install -g typescript
git clone https://github.com/Last-Order/Minyami
cd Minyami
npm install
```

To build the project, just run `tsc`.

## Copyright

Open-sourced under GPLv3. © 2018-2025, Eridanus Sora, member of MeowSound Idols.
