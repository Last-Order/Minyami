# 读读窝

## 依赖
* openssl
* mkvmerge

请安装这两个并确保系统变量`PATH`中添加这两个所在的路径。

## 安装

```
npm install minyami -g
```

此外，你还有两种方法来探测网页上支持下载的视频流。

1. 安装 Chrome 插件（推荐）：https://chrome.google.com/webstore/detail/minyami/cgejkofhdaffiifhcohjdbbheldkiaed （同样[开源](https://github.com/Last-Order/Minyami-chrome-extension)）。

2. 安装用户脚本（不推荐，将停止维护）：

项目根目录有一个`minyami.user.js`，使用 VioletMonkey 之类的脚本管理器安装。在网页中使用两次回车来调出。

## 用法
```
Help:
     命令                      描述                   别名

     --help <command>              显示帮助       --h
         <command>                 显示某命令的帮助
     --version                     显示版本号
     --download <input_path>       下载视频             --d
         <input_path>              m3u8 文件路径
         --threads <limit>         并发数量限制
             <limit>               (可选) 并发数量的限制，默认为5
         --retries <limit>         重试次数
             <limit>               (可选) 重试次数的限制
         --output, o <path>        输出限制
             <path>                (可选) 输出文件路径，默认为 ./output.mkv
         --key <key>               手动设置 Key
             <key>                 (可选) 视频解密 Key.
         --live                    直播下载模式
         --nomux                   （废弃）
         --format <format_name>    (可选) 输出格式，默认为 ts
             <format_name>         格式名称，ts 或 mkv
         --proxy <socks-proxy>     通过 Socks 代理下载
             <socks-proxy>         代理地址，格式为 [<host>:<port>] 例如 --proxy "127.0.0.1:1080"
         --slice <range>           下载部分内容
             <range>               设置时间范围，格式为 [<hh:mm:ss>-<hh:mm:ss> format] 例如 --slice "45:00-53:00"
     --resume <input_path>         恢复下载 (不适用于直播)  --r
         <input_path>              m3u8 文件路径
     --clean                       清除缓存文件和任务信息

选项:

     选项名                       描述
     --verbose, debug             调试输出
```
