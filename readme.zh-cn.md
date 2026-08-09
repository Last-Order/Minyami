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

当 CLI 收到包含多个流的 master playlist 时，Minyami 会显示交互式菜单，并按带宽从高到低列出可用的
分辨率、帧率和编码。如果标准输入或输出没有连接到 TTY，Minyami 会输出警告并回退到最高带宽流，避免
脚本阻塞。master playlist 只有一个流时不会询问。

## 作为库使用

可以通过 `variantSelector` 自定义 master playlist 的流选择：

```TypeScript
import { createArchiveDownloader } from "minyami";

const downloader = createArchiveDownloader("https://example.com/master.m3u8", {
    output: "./archive.ts",
    variantSelector: (variants) => variants.find((variant) => variant.resolution?.height === 720),
});

await downloader.download();
```

选择器会按 playlist 原始顺序收到候选流，并可返回其中同一个候选对象、该对象的 Promise，或返回
`undefined` 正常取消下载。archive、live 和 `HLSSourceOptions` 都支持此选项；库调用未传入时默认选择
最高带宽流。

## 常见问题

Q: 下载时需要保持视频窗口打开吗？

A: 不需要。

Q: 如何设置代理？

A: 可以使用`--proxy`参数设置代理，详见上方用法。目前支持`HTTP/HTTPS/SOCKS5`代理。您也可以使用环境变量设置代理，默认读取`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`。

Q: 如何设置临时文件目录？

A: 默认情况下，Minyami 会在当前工作目录下创建 `minyami_<时间戳>_<随机值>` 临时目录。可以使用 `--temp-dir` 指定其他父目录。

Q: 如何设置多个 HTTP Header？

A: 通过设置多个`-H`或`--headers`，例如`minyami -d xxxx -H "Cookie: xxxx" --headers "User-Agent: yyy"`。
