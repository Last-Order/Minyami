# README
[![Build Status](https://travis-ci.org/Last-Order/Minyami.svg?branch=master)](https://travis-ci.org/Last-Order/Minyami)

## Dependencies

* openssl
* mkvmerge

Make sure you had put these binary files into your system `PATH`.

## Installation

`npm install minyami -g`

There's also a UserScript in the root directory of this project called `Minyami Extractor` which can help you to extract m3u8 files urls from web pages. Please install it with a browser UserScript management extension such as VioletMoney(recommended).

Press `Enter` twice to show `Minyami Extractor` on supported websites.

## Usage

```
Help:
     Commands                      Description                   Alias

     --help <command>              Show help documentation       --h
         <command>                 Show help of a specified command
     --version                     Show version
     --download <input_path>       Download video                --d
         <input_path>              m3u8 file path
         --threads <limit>         Threads limit
             <limit>               (Optional) Limit of threads, defaults to 5
         --retries <limit>         Retry limit
             <limit>               (Optional) Limit of retry times
         --output, o <path>        Output path
             <path>                (Optional) Output file path, defaults to ./output.mkv
         --key <key>               Set key manually
             <key>                 (Optional) Key for decrypt video.
         --live                    Download live
         --nomux                   Merge chunks without remuxing
         --proxy <socks-proxy>     Download via Socks proxy
             <socks-proxy>         Set Socks Proxy in [<host>:<port>] format. eg. --proxy "127.0.0.1:1080".
         --slice <range>           Download specified part of the stream
             <range>               Set time range in [<hh:mm:ss>-<hh:mm:ss> format]. eg. --slice "45:00-53:00"
     --resume <input_path>         Resume a download. (Archive)  --r
         <input_path>              m3u8 file path
     --clean                       Clean cache files

Options:

     Options                       Description
     --verbose, debug              Debug output
```

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

Open-sourced under GPLv3. © 2018, Eridanus Sora, member of MeowSound Idols.
