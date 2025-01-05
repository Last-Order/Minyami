# README

[![Build Status](https://github.com/Last-Order/Minyami/workflows/Node%20CI/badge.svg)](https://github.com/Last-Order/Minyami/actions)

[中文说明](readme.zh-cn.md)

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
         --chunk-naming-strategy   Temporary file naming strategy. Defaults to 1.
     --resume <input_path>         Resume a download. (Archive)  -r
         <input_path>              m3u8 file path
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

## Use as a library (3.1.0+)

```TypeScript
import { ArchiveDownloader } from 'minyami';
import { LiveDownloader } from 'minyami';
```

### Event: `chunk-downloaded`

-   `currentChunkInfo` `<object>` The information of the chunk which is just downloaded.

The `'chunk-downloaded'` event is emitted when every media chunk is downloaded.

### Event: `chunk-error`

-   `error: Error`

The `'chunk-error'` event is emitted when failed to download or decrypt media chunks.

### Event: `downloaded`

The `'downloaded'` event is emitted after all chunks are downloaded but before starting merge.

### Event: `finished`

The `'finished'` event is emitted after all the works are done. CLI program exits after this event is emitted.

### Event: `merge-error`

-   `error: Error`

The `merge-error` event is emitted when a merge progress is failed.

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
