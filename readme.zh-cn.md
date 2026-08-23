# Minyami

[English](readme.md)

> **维护说明：** Minyami 已进入维护模式，后续仅接受问题修复。新安装建议使用 [iori](https://github.com/iori-rs/iori)。

## 运行要求

- Node.js 24 或更高版本，推荐使用活跃的 LTS 版本。
- `mkvmerge` 或 `ffmpeg` 为可选依赖。如需混流独立音视频轨道，请安装其中一个并将其加入 `PATH`。
- 解密 fMP4/CMAF `SAMPLE-AES`（`cbcs`）播放列表时，需确保 Bento4 `mp4decrypt` 位于 `PATH` 中。

## 安装

```shell
npm install --global minyami
```

也可以使用 Yarn：

```shell
yarn global add minyami
```

如需在 Chrome 中方便地检测播放列表，请安装 [Minyami Chrome 扩展](https://chrome.google.com/webstore/detail/minyami/cgejkofhdaffiifhcohjdbbheldkiaed)。扩展源码位于[独立仓库](https://github.com/Last-Order/Minyami-chrome-extension)。

## 命令行用法

下载播放列表：

```shell
minyami --download "https://example.com/video.m3u8" --output "./video.ts"
```

常用示例：

```shell
# 使用 8 个并发下载任务
minyami -d "https://example.com/video.m3u8" --threads 8

# 添加多个请求头
minyami -d "https://example.com/video.m3u8" -H "Cookie: session=..." -H "User-Agent: ..."

# 下载指定时间范围
minyami -d "https://example.com/video.m3u8" --slice "45:00-53:00"

# 持续下载直播，直至手动停止命令
minyami -d "https://example.com/live.m3u8" --live

# 使用 HTTP、HTTPS 或 SOCKS5 代理
minyami -d "https://example.com/video.m3u8" --proxy "http://127.0.0.1:1080"
```

### 参数

| 参数 | 说明 |
| --- | --- |
| `--help`、`-h` | 显示帮助；传入命令名可查看对应命令的帮助。 |
| `--version` | 显示当前版本。 |
| `--download <input>`、`-d <input>` | 下载 m3u8 地址或文件。 |
| `--threads <数量>` | 设置并发数量，默认为 `5`。 |
| `--retries <次数>` | 同时设置来源请求和下载任务的最大尝试次数，默认为 `5`。 |
| `--output <路径>`、`-o <路径>` | 设置输出文件基名，默认为 `./output`。 |
| `--temp-dir <路径>` | 设置临时文件所在的父目录。 |
| `--key <key\|kid:key>` | 手动指定 HLS 解密密钥，也可在密钥前附加 KID。多个密钥必须重复使用 `--key`。 |
| `--cookies <内容>` | 为下载请求添加 Cookie。 |
| `--headers <请求头>`、`-H <请求头>` | 添加 HTTP 请求头；可重复使用以添加多个请求头。 |
| `--live` | 持续下载直播播放列表。 |
| `--proxy <地址>` | 使用 HTTP、HTTPS 或 SOCKS5 代理。 |
| `--no-proxy` | 忽略代理环境变量和系统代理设置。 |
| `--slice <开始-结束>` | 下载指定时间范围，例如 `45:00-53:00`。 |
| `--no-merge` | 不合并已下载的分块。 |
| `--keep`、`-k` | 保留临时文件。 |
| `--keep-encrypted-chunks` | 解密后保留加密分块，需与 `--keep` 一起使用。 |
| `--verbose`、`--debug` | 输出调试信息。 |

如果 master playlist 包含多个流选项，Minyami 会按带宽从高到低显示交互式菜单。在非交互式终端中，程序会自动选择带宽最高的选项。只有一个选项时会直接开始下载。

## 作为库使用

Minyami 以 ESM 格式发布，请使用 `import` 加载，不支持 CommonJS `require()`。

下载点播播放列表：

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

通过库调用时，需将解析后的显式密钥作为 `HLSExplicitKey` 对象传入，例如 `explicitKeys: [{ key }]` 或
`explicitKeys: [{ kid, key }]`；CLI 则接受等价的紧凑格式 `key` 和 `kid:key`。

下载直播时使用 `createLiveDownloader`，需要结束下载时调用 `stop()`：

```TypeScript
import { createLiveDownloader } from "minyami";

const downloader = createLiveDownloader("https://example.com/live.m3u8", {
    output: "./live.ts",
});

setTimeout(() => downloader.stop(), 60_000);
await downloader.download();
```

可以使用 `streamSelector` 从 master playlist 中选择轨道。返回某个选项中的轨道，或返回 `undefined` 取消下载：

```TypeScript
const downloader = createArchiveDownloader("https://example.com/master.m3u8", {
    streamSelector: (catalog) =>
        catalog.options.find((option) =>
            option.tracks.some((track) => track.type === "video" && track.height === 720)
        )?.tracks,
});

await downloader.download();
```

未设置 `streamSelector` 时，库会选择最高带宽选项中的全部轨道。

## 常见问题

### 下载时需要保持浏览器窗口打开吗？

不需要。

### 如何设置代理？

使用 `--proxy`，或设置 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 环境变量。在 Windows 上，Minyami 也可以读取系统代理设置。使用 `--no-proxy` 可忽略这些代理配置。

### 如何修改临时文件目录？

使用 `--temp-dir <路径>`。默认情况下，Minyami 会在当前工作目录中创建 `minyami_<时间戳>_<随机值>` 目录。

### 如何添加多个 HTTP 请求头？

重复使用 `-H` 或 `--headers`：

```shell
minyami -d "https://example.com/video.m3u8" -H "Cookie: ..." --headers "User-Agent: ..."
```

## 许可证

GPLv3。© 2018-2025 Eridanus Sora，MeowSound Idols 成员。
