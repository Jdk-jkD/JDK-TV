# JDK TV

基于 [LibreSpark/LibreTV](https://github.com/LibreSpark/LibreTV) **v2.22.0** 二次开发的个人影视发现与播放工具，采用 **AGPL-3.0-or-later**，保留上游贡献者署名。JDK TV 是非官方衍生项目，来源见 [NOTICE.md](NOTICE.md)。

## Windows 绿色版

从 [Releases](https://github.com/Jdk-jkD/JDK-TV/releases) 下载 Windows x64 ZIP，完整解压到可写文件夹，双击 `Start-JDKTV.vbs`。失败时运行 `Start-JDKTV.cmd`。需要 Windows 10/11 x64 和已安装的 Chrome 或 Edge，Node 随包提供。

每台电脑独立运行，作者电脑关机不影响使用。播放需要联网，使用者自行配置有权访问的点播 API 或 M3U/XMLTV 清单。发行包默认没有预置片源。

首次启动生成独立浏览器数据、配置、日志与缓存。退出窗口后，双击 `Stop-JDKTV.cmd` 停止后台服务。入口和后台只监听 `127.0.0.1:8080/8081`，端口占用会报错。

升级前退出窗口、停止服务，并在设置 → 数据导出备份。用新版替换 `app`、`runtime` 和启动脚本，保留自己的 `browser-profile` 和 `config`。勿使用他人的浏览器资料。

## 功能与改动

- 首页、单片宽屏、多集侧栏及窄屏布局。
- 搜索聚合、失败源下拉和一键重试、画质探测。
- HLS 播放、倍速、缩放、片头片尾标记、播放统计。
- 分片测速与符合匹配条件时保留进度换源。
- 我的片单、想看、追更、检查已选线路新集和续播。
- 直播源、M3U/XMLTV、本地缓存、配置备份恢复和代理安全修复。

实际播放依赖网络、来源、编码和浏览器。尺寸不能证明原片细节，当前没有 AI 超分。不同线路的剧集及剪辑可能不同。当前发行面向 Windows，尚未发布其他平台安装包。

## 数据与安全

记录与配置存于各自设备，没有账号云同步。缓存和视频下载不包含在 JSON 备份中。分享配置前检查私人地址、令牌与记录。本机自动认证入口仅适用于本机，对外服务需要独立认证及安全部署。来源数据与内容使用需有相应授权。本项目不托管视频文件。见 [SECURITY.md](SECURITY.md)。

## 开发

使用 Node 22.12+ 或 24 LTS。依次运行 `npm ci`、`npm test`、`npm run lint`、`npm run typecheck`、`npm run build`。开发时复制 `.env.example` 为 `.env.local`，设置 PASSWORD 并运行 `npm run dev`。

## 构建绿色包

在 Windows x64 设置 DOCKER_BUILD=1 和 NEXT_TELEMETRY_DISABLED=1 后执行 `npm run build`。把官方 Windows x64 Node 的 node.exe 与完整 LICENSE 放在运行时目录，再执行 `python scripts/package-portable.py --node-dir <运行时目录> --output <输出目录>`。脚本输出绿色包、对应源码和 SHA-256。发行包未做 Windows 数字签名。
