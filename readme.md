# Minyami

[![Build Status](https://github.com/Last-Order/Minyami/workflows/Node%20CI/badge.svg)](https://github.com/Last-Order/Minyami/actions)

[中文说明](readme.zh-cn.md)

## Requirements

- Node.js 24 or newer; an active LTS release is recommended.
- `mkvmerge` or `ffmpeg` is optional. Install either one and add it to `PATH` if you need to mux separate audio and video tracks.

## Installation

```shell
npm install --global minyami
```

You can also install it with Yarn:

```shell
yarn global add minyami
```

For convenient playlist detection in Chrome, install the [Minyami Chrome extension](https://chrome.google.com/webstore/detail/minyami/cgejkofhdaffiifhcohjdbbheldkiaed). Its source is available in the [extension repository](https://github.com/Last-Order/Minyami-chrome-extension).

## Command-line usage

Download a playlist:

```shell
minyami --download "https://example.com/video.m3u8" --output "./video.ts"
```

Useful examples:

```shell
# Use eight concurrent downloads
minyami -d "https://example.com/video.m3u8" --threads 8

# Send multiple request headers
minyami -d "https://example.com/video.m3u8" -H "Cookie: session=..." -H "User-Agent: ..."

# Download a time range
minyami -d "https://example.com/video.m3u8" --slice "45:00-53:00"

# Follow a live playlist until you stop the command
minyami -d "https://example.com/live.m3u8" --live

# Use an HTTP, HTTPS, or SOCKS5 proxy
minyami -d "https://example.com/video.m3u8" --proxy "http://127.0.0.1:1080"
```

### Options

| Option | Description |
| --- | --- |
| `--help`, `-h` | Show help. Pass a command name to show command-specific help. |
| `--version` | Show the installed version. |
| `--download <input>`, `-d <input>` | Download an m3u8 URL or file. |
| `--threads <number>` | Set the concurrency limit. The default is `5`. |
| `--retries <number>` | Set the maximum attempts for both source requests and download tasks. The default is `5`. |
| `--output <path>`, `-o <path>` | Set the output basename. The default is `./output`. |
| `--temp-dir <path>` | Choose the parent directory for temporary files. |
| `--key <key>` | Supply an explicit HLS decryption key. The common HLS adapter applies it to every key URI and skips remote key downloads. |
| `--cookies <cookies>` | Send cookies with download requests. |
| `--headers <header>`, `-H <header>` | Send a custom HTTP header. Repeat the option to send multiple headers. |
| `--live` | Follow a live playlist. |
| `--proxy <url>` | Use an HTTP, HTTPS, or SOCKS5 proxy. |
| `--no-proxy` | Ignore proxy environment variables and system proxy settings. |
| `--slice <start-end>` | Download a time range such as `45:00-53:00`. |
| `--no-merge` | Keep downloaded chunks separate. |
| `--keep`, `-k` | Keep temporary files. |
| `--keep-encrypted-chunks` | Keep encrypted chunks after decryption. Use with `--keep`. |
| `--verbose`, `--debug` | Enable debug output. |

If a master playlist contains multiple stream options, Minyami displays an interactive menu ordered by bandwidth. In a non-interactive terminal, it selects the highest-bandwidth option automatically. A playlist with only one option starts without prompting.

## Use as a library

Minyami is distributed as ESM and must be loaded with `import` rather than CommonJS `require()`.

Download an archive playlist:

```TypeScript
import { createArchiveDownloader } from "minyami";

const downloader = createArchiveDownloader("https://example.com/archive.m3u8", {
    output: "./archive.ts",
    threads: 8,
});

downloader.on("chunk-downloaded", (chunk) => {
    console.log(chunk);
});

await downloader.download();
```

For a live playlist, create a live downloader and call `stop()` when you want to finish:

```TypeScript
import { createLiveDownloader } from "minyami";

const downloader = createLiveDownloader("https://example.com/live.m3u8", {
    output: "./live.ts",
});

setTimeout(() => downloader.stop(), 60_000);
await downloader.download();
```

Use `streamSelector` to choose tracks from a master playlist. Return tracks from one of the provided options, or return `undefined` to cancel the download:

```TypeScript
const downloader = createArchiveDownloader("https://example.com/master.m3u8", {
    streamSelector: (catalog) =>
        catalog.options.find((option) =>
            option.tracks.some((track) => track.type === "video" && track.height === 720)
        )?.tracks,
});

await downloader.download();
```

When `streamSelector` is omitted, the library selects all tracks from the highest-bandwidth option.

## FAQ

### Do I need to keep the browser open while downloading?

No.

### How do I configure a proxy?

Pass `--proxy`, or set `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY`. On Windows, Minyami can also use the system proxy settings. Pass `--no-proxy` to ignore all of these settings.

### How do I change the temporary file location?

Pass `--temp-dir <path>`. By default, Minyami creates a `minyami_<timestamp>_<random>` directory under the current working directory.

### How do I send multiple HTTP headers?

Repeat `-H` or `--headers`:

```shell
minyami -d "https://example.com/video.m3u8" -H "Cookie: ..." --headers "User-Agent: ..."
```

## License

GPLv3. © 2018-2025 Eridanus Sora, member of MeowSound Idols.
