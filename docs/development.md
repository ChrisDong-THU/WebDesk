# 开发与构建

## 环境

- 网页/服务端：Node.js 22，npm，Git。
- Windows 客户端：Windows x64、Visual Studio 2022 的 Desktop development with C++ 工作负载、Windows SDK、.NET Framework 编译器。
- Flutter、flutter-webrtc、libwebrtc、Inno Setup 的版本与校验码在 `native/flutter/dependencies.json` 固定；不要随意替换预编译原生库。

## 网页和服务端

```sh
npm ci
```

复制 `.env.example` 为 `.env`，分别运行 `npm run server` 与 `npm run dev`。Vite 在 5173 端口提供页面，将 `/socket.io` 代理到 4300。运行 `npm run preview:ui` 可查看不连接设备的模拟界面。

```sh
npm test
npm run build
npm run release:check
```

`npm test` 会先构建网页，确保静态资源集成测试在全新检出中也能运行。CI 在 Linux 上验证网页和协议。`npm run test:windows` 是 Windows 上真实 WebRTC 的兼容适配器测试，不向系统注入键鼠，也不能代替 Flutter 原生客户端验收。公网测试需显式设置 `WEBDESK_TEST_SERVER`，使用你有权访问的 HTTPS 服务。

## Flutter Windows

```powershell
npm run prepare:flutter
npm run dev:host
```

准备脚本检出固定 SDK 与插件，应用原生补丁、校验 WebRTC 下载，并通过目录联接准备 Windows 插件。构建缓存位于 `.tools/` 与忽略的插件目录，不应提交到 Git。

开发 EXE 不能冒充已安装服务绑定的客户端。需要锁屏/原生输入时安装正式客户端；服务联调脚本会临时重新绑定客户端路径，应只在专用测试电脑上手动运行，勿在有活动会话时并行运行。

## Windows 安装包

1. 从 `native/flutter/dependencies.json` 指定的官方地址下载 Inno Setup，按记录的 SHA-256 校验，安装到本仓库 `.tools/inno/`，确保 `.tools/inno/ISCC.exe` 存在。也可运行 `scripts/setup-inno.ps1` 进行校验和工具安装。
2. 运行：

```powershell
npm run build:inno
```

该命令运行原生构建、Flutter analyze/test，显式编译生产入口 `lib/main.dart`，校验管理员清单和依赖，生成全新 payload，再编译安装器和 SHA-256。输出位于 `flutter-release/<version>/`。此命令不会安装 WebDesk。

只预览安装界面：`npm run preview:installer`。预览程序不安装应用或服务；`scripts/preview-installer.ps1 -ValidateOnly` 仅检查脚本。

GitHub 的 **Windows build** workflow 可手动构建，并上传安装包 Artifact；不会自动发布 Release 或部署服务器。

## 版本与源码边界

版本必须同步更新 `package.json`、根锁文件、`deploy/runtime` 两份 JSON 和 `desktop/flutter/pubspec.yaml`。Dart build number 随发布增加。运行 `npm run release:check`。

上游生成块不能直接手改。先编辑提取脚本或适配层，再运行 `npm run upstream:check`。第三方原生补丁保存在 `native/flutter/flutter-webrtc.patch`。升级原生依赖时也应更新 `third_party/licenses/` 的来源和许可文本。

## 发布检查

- 完成 Node/Flutter 分析与测试，以及 Windows 实机回归。
- 确认安装包只含生产入口、原生服务和运行依赖；校验升级、卸载和托盘行为。
- 同步 CHANGELOG、tag 与安装包版本，在 Release 中列出已验证范围和已知限制。
- 发布安装 EXE、校验文件和第三方声明；SDK、测试程序、个人日志不进入 Release。
- 签名需由发行者单独配置。本仓库不包含签名证书或自动服务器凭据。
