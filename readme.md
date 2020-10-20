# README
[![Build Status](https://github.com/Last-Order/Minyami/workflows/Node%20CI/badge.svg)](https://github.com/Last-Order/Minyami/actions)

[中文说明](readme.zh-cn.md)

## Dependencies

* mkvmerge (optional, mkv output required)

! Minyami requires Node 10.5.0+

Make sure you had put the binary files into your system `PATH`.

## Installation

`npm install minyami -g`

Please also install the following extension to work with Minyami

1. Install Chrome extension (recommended): https://chrome.google.com/webstore/detail/minyami/cgejkofhdaffiifhcohjdbbheldkiaed (which is also open-sourced [here](https://github.com/Last-Order/Minyami-chrome-extension))

## Usage

```
Help:
     Commands                      Description                   Alias

     --help <command>              Show help documentation       --h
         <command>                 Show help of a specified comma
     --version                     Show version
     --download <input_path>       Download video                --d
         <input_path>              m3u8 file path
         --threads <limit>         Threads limit
             <limit>               (Optional) Limit of threads, defaults to 5
         --retries <limit>         Retry limit
             <limit>               (Optional) Limit of retry times
         --output, o <path>        Output path
             <path>                (Optional) Output file path, defaults to ./output.mkv
         --key <key>               Set key manually (Internal use)
             <key>                 (Optional) Key for decrypt video.
         --cookies <cookies>       Cookies to download
             <cookies>
         --headers <headers>       HTTP Headers used to download
             <headers>             Multiple headers should be splited with \n. eg. --header "Cookie: a=1\nUser-Agent: X-UA". Don't forget to escape. This option will override --cookies.
         --live                    Download live
         --format <format_name>    (Optional) Set output format. default: ts
             <format_name>         Format name. ts or mkv.
         --proxy <socks-proxy>     Download via Socks proxy
             <socks-proxy>         Set Socks Proxy in [<host>:<port>] format. eg. --proxy "127.0.0.1:1080".
         --slice <range>           Download specified part of the stream
             <range>               Set time range in [<hh:mm:ss>-<hh:mm:ss> format]. eg. --slice "45:00-53:00"
         --nomerge                 Do not merge m3u8 chunks.
     --resume <input_path>         Resume a download. (Archive)  --r
         <input_path>              m3u8 file path
     --clean                       Clean cache files

Options:

     Options                       Description
     --verbose, debug              Debug output
```

## FAQ

Q: Should I keep the browser open when downloading?

A: It's not necessary.

## Use as a library (3.1.0+)

```TypeScript
import { ArchiveDownloader } from 'minyami';
import { LiveDownloader } from 'minyami';
```
### Event: `chunk-downloaded`

* `currentChunkInfo` `<object>` The information of the chunk which is just downloaded. 

The `'chunk-downloaded'` event is emitted when every media chunk is downloaded. 

### Event: `downloaded`

The `'downloaded'` event is emitted after all chunks are downloaded but before starting merge.

### Event: `finished`

The `'finished'` event is emitted after all the works are done. CLI program exits after this event is emiited.


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

Open-sourced under GPLv3. © 2018-2020, Eridanus Sora, member of MeowSound Idols.
