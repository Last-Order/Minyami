# README

[![Build Status](https://github.com/Last-Order/Minyami/workflows/Node%20CI/badge.svg)](https://github.com/Last-Order/Minyami/actions)

[中文说明](readme.zh-cn.md)

> **Deprecation Notice:** Minyami is aging and has entered maintenance mode. No new features will be implemented in the foreseeable future; only bug fixes will be accepted. We recommend using [iori](https://github.com/iori-rs/iori) as an alternative.

## Dependencies

-   mkvmerge (optional, mkv output required)

! Minyami requires Node.js 22 or newer. An active LTS release is recommended.

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
             <path>                (Optional) Temporary file path, defaults to the current working directory
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
Options:

     Options                       Description
     --verbose, debug              Debug output
```

When the CLI receives a master playlist containing multiple streams, Minyami opens an interactive menu. Streams are
shown from highest to lowest bandwidth with their available resolution, frame rate, and codecs. If standard
input or output is not attached to a TTY, Minyami warns and selects the highest-bandwidth stream so scripts do not
block. A master playlist with only one stream continues without prompting.

## FAQ

Q: Should I keep the browser open when downloading?

A: It's not necessary.

Q: How to set proxy for Minyami?

A: You can use `--proxy` to set proxy server for Minyami. HTTP/SOCKS5 proxy are supported. Or you can use environment variables `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` to provide proxy configuration for Minyami. And Minyami will read proxy settings from environment variables and Windows system proxy settings. To disable any proxy setting from context, you can add `--disable-proxy` or set `env.NO_PROXY` to and non-empty values.

Q: How to set temporary file location?

A: By default, Minyami creates its `minyami_<timestamp>_<random>` temporary directory in the current working directory. You can use `--temp-dir` to select a different parent directory.

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
    streamSelector: (catalog) =>
        catalog.options.find((option) =>
            option.tracks.some((track) => track.type === "video" && track.height === 720)
        )?.tracks,
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

`streamSelector` receives a protocol-neutral `StreamCatalog`. Its options describe compatible track sets derived from
the manifest; the selector returns a non-empty array containing exact track objects from one option, a promise for
one, or `undefined` to cancel normally. Returning a subset can select particular audio languages or produce an
audio-only download. The same API can represent HLS now and MPEG-DASH later without exposing playlist URLs or
protocol identifiers. It is available on archive downloads, live downloads, and `HLSSourceOptions`. Library calls
select every track in the highest-bandwidth option when the selector is omitted.

The same execution engine can also consume a source directly. An HLS source in `snapshot` mode yields one batch per
selected physical track; `follow` mode refreshes all selected playlists concurrently and yields newly discovered
chunks until every track ends or the controller is stopped.

```TypeScript
import { createDownloader, createHLSSource } from "minyami";

const downloader = createDownloader(
    createHLSSource("https://example.com/live.m3u8", { mode: "follow" }),
    { output: "./live.ts" }
);

await downloader.download();
```

Custom implementations of `DownloadSource` declare their tracks during `prepare()` and may then yield any number of
single-track `SourceBatch` values. Sources produce immutable `DownloadItem` values; the downloader owns global task
ids, track-local merge indices, filenames, retries, scheduling, progress, and output merging.

```TypeScript
const source = {
    sourcePath: "custom://presentation",
    continuous: false,
    async prepare() {
        return {
            tracks: [
                { id: "video", type: "video", sourcePath: "https://example.com/video.m3u8" },
                { id: "audio", type: "audio", language: "en", sourcePath: "https://example.com/audio.m3u8" },
            ],
        };
    },
    async *discover() {
        yield { trackId: "video", items: [videoItem], totalItemCount: 1 };
        yield { trackId: "audio", items: [audioItem], totalItemCount: 1 };
    },
};
```

Every source track is discriminated by `type: "video" | "audio"`; track ids must be unique safe identifiers containing
1–64 letters, numbers, `_`, or `-`. All tracks share one task scheduler but have isolated temporary directories,
ordering, progress, and output concentration. A single track uses the requested output path; multiple tracks use
`<basename>.<trackId><ext>`. Snapshot `sourcePath` is always the original entry point, while each track snapshot
reports its actual upstream path and final outputs. The retained media metadata is also the input boundary for a
future muxing stage.

`DownloadItem` is protocol-neutral. A custom source describes initialization and timed media resources directly;
protocol-specific parser objects must not escape into the downloader:

```TypeScript
const item = {
    url: "https://example.com/segment-1.m4s",
    kind: "media" as const,
    duration: 2,
};

// Encrypted items additionally carry a complete execution descriptor:
const encryptedItem = {
    ...item,
    encryption: {
        scheme: "aes-128-cbc" as const,
        keyId: "https://example.com/key.bin",
        iv: "00000000000000000000000000000001",
    },
};
```

Before yielding an encrypted item, the source must register its key in `DownloadSourceContext.keys` under the same
`keyId`. The downloader validates this contract before issuing the item's network request.

### Progress semantics

Snapshots report successful, dropped, and completed work separately:

-   `completedChunkCount`: resolved tasks, equal to `successfulChunkCount + droppedChunkCount`.
-   `successfulChunkCount`: chunks downloaded and processed successfully.
-   `droppedChunkCount`: chunks abandoned after reaching the configured retry limit.
-   `successfulDuration`: total media duration in seconds from successfully processed media chunks; initialization segments and dropped chunks do not add duration.

Top-level progress is aggregated across all tracks. Each track snapshot exposes the same counters for that track;
therefore multi-track top-level `successfulDuration` is media-processing throughput, not presentation duration.

Completion percentage and ETA use `completedChunkCount`. Download speed and the successful-duration ratio use only
successful chunks.

### Event: `chunk-downloaded`

-   `taskName` `<string>` The filename of the chunk that was just downloaded.
-   `trackId` `<string>` The track that owns the chunk.
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
-   `taskName: string`
-   `trackId: string`

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

Minyami is developed with TypeScript and tested with Jest.

**Install development dependencies**

```
git clone https://github.com/Last-Order/Minyami
cd Minyami
npm install
```

Run `npm test` for the modular TypeScript test suite and `npm run build` to build the project.

## Copyright

Open-sourced under GPLv3. © 2018-2025, Eridanus Sora, member of MeowSound Idols.
