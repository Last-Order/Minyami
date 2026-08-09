# 读读窝

## 依赖
* mkvmerge (可选，mkv 格式输出需要)

! Minyami 要求使用 Node.js 22 或更高版本，推荐选用活跃 LTS 版本。

需安装并确保系统变量`PATH`中添加可执行程序所在的路径。

## 安装

`npm -g i minyami` 或 `yarn global add minyami`

此外，请安装插件配合 Minyami 使用。

1. 安装 Chrome 插件（推荐）：https://chrome.google.com/webstore/detail/minyami/cgejkofhdaffiifhcohjdbbheldkiaed （同样[开源](https://github.com/Last-Order/Minyami-chrome-extension)）。


## 用法
```
Help:
     命令                      描述                   别名

     --help <command>              显示帮助       -h
         <command>                 显示某命令的帮助
     --version                     显示版本号
     --download <input_path>       下载视频             -d
         <input_path>              m3u8 文件路径
         --threads <limit>         并发数量限制
             <limit>               (可选) 并发数量的限制，默认为5
         --retries <limit>         重试次数
             <limit>               (可选) 重试次数的限制
         --output, o <path>        输出限制
             <path>                (可选) 输出文件路径，默认为 ./output.mkv
         --temp-dir <path>         临时文件路径
             <path>                (可选) 临时文件路径，默认为当前工作目录
         --key <key>               手动设置 Key
             <key>                 (可选) 视频解密 Key.
         --cookies <cookies>       (可选) 视频下载 Cookies
             <cookies>
         --headers, H <headers>    手动设定 HTTP Header
             <headers>             自定义 HTTP Header，例如："User-Agent: X-UA"
         --live                    直播下载模式
         --format <format_name>    (可选) 输出格式，默认为 ts
             <format_name>         格式名称，ts 或 mkv
         --proxy <proxy-server>    为 Minyami 设置代理
             <proxy-server>        代理地址，格式为 [protocol://<host>:<port>] 例如 --proxy "http://127.0.0.1:1080"
         --slice <range>           下载部分内容
             <range>               设置时间范围，格式为 [<hh:mm:ss>-<hh:mm:ss> format] 例如 --slice "45:00-53:00"
         --nomerge, keep           不合并视频分块。
         --keep-encrypted-chunks   不删除解密前分块。与--keep一起使用。
选项:

     选项名                       描述
     --verbose, debug             调试输出
```

当 CLI 收到包含多个流选项的 master playlist 时，Minyami 会显示交互式菜单，并按带宽从高到低列出
视频规格和关联音轨。如果标准输入或输出没有连接到 TTY，Minyami 会输出警告并回退到最高带宽选项，
避免脚本阻塞。只有一个选项时不会询问。

## 作为库使用

可以通过 `streamSelector` 自定义 master playlist 的轨道选择：

```TypeScript
import { createArchiveDownloader } from "minyami";

const downloader = createArchiveDownloader("https://example.com/master.m3u8", {
    output: "./archive.ts",
    streamSelector: (catalog) =>
        catalog.options.find((option) =>
            option.tracks.some((track) => track.type === "video" && track.height === 720)
        )?.tracks,
});

await downloader.download();
```

选择器收到协议无关的 `StreamCatalog`。其中 option 表示 Manifest 推导出的兼容轨道集合；选择器应返回
同一个 option 中一个或多个原始 track 对象、其 Promise，或返回 `undefined` 正常取消。返回 option 的
子集可以只下载指定语言或只下载音频。公共 track 不包含 HLS URL 等协议字段，因此同一选择 API 未来
也可用于 MPEG-DASH。archive、live 和 `HLSSourceOptions` 都支持此选项；未传入时默认选择最高带宽
option 中的全部轨道。

共享下载器支持 source 在 `prepare()` 阶段声明多条 track，之后每个 `SourceBatch` 通过 `trackId` 归属到
其中一条 track。所有 track 共用调度器，但分别维护临时目录、轨内顺序、进度和输出归并。单轨沿用指定
输出名；多轨使用 `<文件名>.<trackId><扩展名>`。顶层快照的 `sourcePath` 始终是原始入口地址，实际
media playlist 地址和最终输出文件位于各 track 快照中。

```TypeScript
const source = {
    sourcePath: "custom://presentation",
    continuous: false,
    async prepare() {
        return {
            tracks: [
                {
                    id: "video",
                    mediaTrack: { id: "presentation/video", type: "video" },
                    sourcePath: "https://example.com/video.m3u8",
                },
                {
                    id: "audio",
                    mediaTrack: { id: "presentation/audio/en", type: "audio", language: "en" },
                    sourcePath: "https://example.com/audio.m3u8",
                },
            ],
        };
    },
    async *discover() {
        yield { trackId: "video", items: [videoItem], totalItemCount: 1 };
        yield { trackId: "audio", items: [audioItem], totalItemCount: 1 };
    },
};
```

`SourceTrack.id` 是临时目录和输出后缀使用的执行标识，因此必须是由字母、数字、`_`、`-` 组成的
1–64 位安全且唯一的名称。`SourceTrack.mediaTrack` 则是 selector 接收到的同一个逻辑描述对象，
其中的不透明 id 不受文件名规则限制。HLS 外置音轨会成为独立下载轨，内嵌音频则保留在原始物理轨中，
不会产生重复输出。snapshot 模式会为每条选中轨道产出 batch，follow 模式会并发刷新所有选中播放列表。
track snapshot 和已完成 artifact 都会保留同一个 `MediaTrack` 及其实际上游地址和输出文件，作为后续自动
混流功能的输入边界。

## 常见问题

Q: 下载时需要保持视频窗口打开吗？

A: 不需要。

Q: 如何设置代理？

A: 可以使用`--proxy`参数设置代理，详见上方用法。目前支持`HTTP/HTTPS/SOCKS5`代理。您也可以使用环境变量设置代理，默认读取`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`。

Q: 如何设置临时文件目录？

A: 默认情况下，Minyami 会在当前工作目录下创建 `minyami_<时间戳>_<随机值>` 临时目录。可以使用 `--temp-dir` 指定其他父目录。

Q: 如何设置多个 HTTP Header？

A: 通过设置多个`-H`或`--headers`，例如`minyami -d xxxx -H "Cookie: xxxx" --headers "User-Agent: yyy"`。
