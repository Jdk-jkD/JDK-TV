<p align="center">
  <img src="public/icons/icon-192.png" alt="JDK TV" width="96" height="96">
</p>

<h1 align="center">JDK TV</h1>

<p align="center">把想看的，留在这里。</p>

<p align="center">
  本地优先的开源影视聚合与播放工具 · 自由选源 · 追更片单 · 点播与直播
</p>

<p align="center">
  <a href="https://github.com/Jdk-jkD/JDK-TV/releases/latest">下载绿色版</a> ·
  <a href="#使用说明">使用说明</a> ·
  <a href="https://github.com/Jdk-jkD/JDK-TV/issues">问题反馈</a> ·
  <a href="https://github.com/LibreSpark/LibreTV">上游 LibreTV</a>
</p>

<p align="center">
  <a href="https://github.com/Jdk-jkD/JDK-TV/actions/workflows/ci.yml"><img src="https://github.com/Jdk-jkD/JDK-TV/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL--3.0-blue" alt="AGPL-3.0-or-later"></a>
</p>

JDK TV 基于 [LibreSpark/LibreTV v2.22.0](https://github.com/LibreSpark/LibreTV/tree/v2.22.0) 二次开发，围绕本地使用、自由选源和追剧体验，扩展首页、播放器、片单与播放诊断功能。基于 Next.js、React 和 TypeScript，使用 ArtPlayer + hls.js 播放视频。

## 项目特色

### 本地运行，轻松开始

Windows 绿色版将运行环境与程序一起打包，解压后双击即可打开，无需另外安装 Node.js、配置 Docker 或维护中心服务器。每台设备各自运行，不依赖其他人的电脑在线。

### 记录留在本机，存储由你控制

片单、观看历史、播放进度、应用配置和视频分片缓存保存在使用者的设备上，无需注册平台账号或开启账号云同步。支持配置备份与恢复，以及缓存容量设置和清理。

Windows 绿色版的服务只监听本机回环地址，并检查请求来源，限制其他设备和外部网页直接访问本地入口。

> 本地运行仍可播放在线内容：搜索、封面、节目单和视频会连接所选的数据源；流媒体按需加载，完整影片不会自动全部下载到本地。

### 自由搭配片源，点播直播一起管理

按需添加 Apple CMS 点播接口、M3U 直播列表和 XMLTV 节目单，也可以通过订阅组合多组来源。搜索结果可聚合比较，观看时选择合适的线路，不绑定单一内容服务。

### 从“找到影片”到“持续追剧”

电影加入“想看”，电视剧和番剧加入“追更”，在“我的片单”统一管理。保留观看进度，支持继续播放，并检查已选来源的剧集更新。

### 更适合观看的布局与诊断

单集影片采用宽屏布局，多集内容配合选集侧栏；提供画面适配、手动缩放和片段跳过。线路测速、画质信息与播放状态帮助判断播放表现，搜索失败源集中展示并支持一键重试。

上述特色包含对 LibreTV 既有能力的延续。本项目的扩展重点是 Windows 绿色启动、首页与播放布局、统一追更片单、失败源交互和播放诊断体验。

## 核心功能

| 功能 | 说明 |
| --- | --- |
| 聚合搜索 | 多源检索、同名结果合并、来源选择与失败重试 |
| 视频播放 | HLS 播放、倍速、连续播放、快捷键、画面比例与缩放 |
| 片段跳过 | 标记片头、片尾等区间，按设置自动跳过 |
| 播放诊断 | 线路测速、画质探测和播放状态信息 |
| 换源续播 | 在内容与时长匹配条件满足时，保留播放位置切换线路 |
| 我的片单 | 想看、追更、更新检查与继续观看 |
| 直播 / IPTV | M3U 分组、频道搜索、收藏和 XMLTV 节目单 |
| 源管理 | 点播与直播来源管理、订阅同步和源可用性检测 |
| 本地缓存 | 视频分片缓存、容量管理与清理 |
| 备份恢复 | 配置及观看记录导出、导入与迁移 |

## 快速开始

### Windows 绿色版

运行环境：**Windows 10 / 11 x64**，已安装 **Chrome 或 Edge**。

1. 前往 [Releases](https://github.com/Jdk-jkD/JDK-TV/releases/latest)，下载 `JDK-TV-<版本>-windows-x64.zip`。
2. 完整解压到可写文件夹，不要在压缩包内直接运行。
3. 双击 `Start-JDKTV.vbs` 打开程序。
4. 使用结束后，运行 `Stop-JDKTV.cmd` 停止后台服务。

启动失败时，使用 `Start-JDKTV.cmd` 查看错误信息。默认使用本机 8080 / 8081 端口，启动前请确认端口未被其他程序占用。

### 使用说明

1. **添加片源**：设置 → 源管理 → 点播源 → 添加 API，填写 Apple CMS 接口地址。
2. **搜索观看**：输入片名，选择来源、线路和剧集进入播放页。
3. **加入片单**：将影片加入“想看”或“追更”，在“我的片单”继续观看、检查新集。
4. **调整画面**：在播放器中设置倍速、画面适配和缩放，按需添加片头片尾标记。
5. **管理缓存**：在设置中调整缓存容量或清理已缓存的分片。

## 直播与源订阅

- **直播**：设置 → 源管理 → 直播源，添加 M3U 列表；有节目单时同时填写 XMLTV 地址，在“直播”页选择频道。
- **订阅**：设置 → 源管理 → 数据源订阅，填入订阅地址后同步来源。
- **兼容格式**：支持 LibreTV-SourceList 和可识别的 TVBOX JSON 接口配置；TVBOX Spider 引擎站点不支持直接执行。

项目提供接口管理、列表解析和播放能力，内容由用户配置的数据源提供。请使用有权访问的接口与内容。

## 常见问题

**本地运行是否可以完全离线观看？**

在线搜索和在线播放需要联网。本地缓存仅覆盖已经保存的分片；完整离线观看需要先完成相应内容的下载。

**为什么有些影片播放卡顿，或者画质不理想？**

实际表现取决于来源带宽、视频码率、编码格式、网络和设备解码能力。可通过测速、画质探测和换源功能比较线路；缩放只改变显示大小，不会增加原片细节。

**追更会自动找到所有网站的新剧集吗？**

更新检查依据已选来源返回的剧集信息。不同来源的更新时间和剧集编排可能不同。

**是否已经支持手机、iPad、Mac 和电视安装包？**

当前发布 Windows x64 绿色版。网页包含窄屏适配，其他平台尚未发布原生安装包。

## 开发

建议使用 Node.js 22.12+ 或 Node.js 24 LTS。

```powershell
git clone https://github.com/Jdk-jkD/JDK-TV.git
cd JDK-TV
npm ci
Copy-Item .env.example .env.local
```

编辑 `.env.local`，设置开发环境的 `PASSWORD`，然后运行：

```powershell
npm run dev
```

开发地址：`http://localhost:8080`。

```powershell
npm test
npm run lint
npm run typecheck
npm run build
python scripts/test-package-privacy.py
```

### 构建 Windows 绿色包

```powershell
$env:DOCKER_BUILD = "1"
$env:NEXT_TELEMETRY_DISABLED = "1"
npm run build
python scripts/package-portable.py --node-dir <Node运行时目录> --output <输出目录>
```

Node 运行时目录应包含官方 Windows x64 `node.exe` 与完整 `LICENSE`。打包脚本输出绿色版、对应源码 ZIP 和 SHA-256 校验文件。当前发行包未进行 Windows 数字签名。

## 开源与致谢

本项目是 [LibreSpark/LibreTV](https://github.com/LibreSpark/LibreTV) 的非官方二次开发版本，遵循 **AGPL-3.0-or-later**。感谢 LibreTV 及 Next.js、React、ArtPlayer、hls.js、Dexie 等开源项目的贡献者。

来源与第三方许可见 [NOTICE.md](NOTICE.md)，完整许可证见 [LICENSE](LICENSE)。安全问题请参阅 [SECURITY.md](SECURITY.md)。

## 免责声明

JDK TV 提供第三方接口的搜索聚合与播放能力，不托管影视内容。使用者应遵守适用规则及内容授权要求。
