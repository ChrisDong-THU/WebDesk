<p align="center"><img src="src/assets/webdesk-icon.svg" width="80" alt="WebDesk"></p>
<h1 align="center">WebDesk</h1>
<p align="center">在浏览器中，连接你的 Windows 桌面。</p>
<p align="center">
<a href="https://github.com/ChrisDong-THU/WebDesk/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/ChrisDong-THU/WebDesk"></a>
<a href="https://github.com/ChrisDong-THU/WebDesk/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ChrisDong-THU/WebDesk/actions/workflows/ci.yml/badge.svg"></a>
<a href="LICENSE.txt"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-green"></a>
<img alt="Windows x64" src="https://img.shields.io/badge/host-Windows%20x64-blue">
</p>
<p align="center"><a href="README.en.md">English</a> · <a href="https://github.com/ChrisDong-THU/WebDesk/releases/latest">下载安装包</a> · <a href="docs/development.md">开发指南</a> · <a href="docs/self-hosting.md">自部署</a></p>

WebDesk 专注于 **Web → Windows** 远程控制。浏览器端使用 Vue 与 WebRTC，Windows 客户端使用 Flutter、原生 WebRTC 和桌面辅助服务，服务端使用 Node.js / Socket.IO。

项目基于 [billd-desk](https://github.com/galaxy-s10/billd-desk) 和 [billd-desk-server](https://github.com/galaxy-s10/billd-desk-server) 的 MIT 开源实现，保留可复现的上游代码与署名。WebDesk 是独立衍生项目，与官方 BilldDesk 产品没有隶属关系，也不包含其闭源客户端源码。

## 功能

- 浏览器查看画面并操作键鼠，支持标点、组合键和双向滚动。
- WebRTC 直连；无法直连时使用自行配置的 TURN 中继。
- 360p、720p、1080p、2K、4K、8K 画质档位，按屏幕实际尺寸适配；画质、码率、帧率可在连接中调整。
- 双向文件传输、文本剪贴板、可选系统声音传输，声音默认关闭。
- 只显示远程画面的全屏模式；Windows 客户端关闭窗口后驻留托盘。
- 原生 Windows 服务支持锁屏桌面切换与输入。锁屏并不等同于睡眠；休眠或断网期间无法保持实时控制。

## 开始使用

1. 从 [Releases](https://github.com/ChrisDong-THU/WebDesk/releases/latest) 下载 `WebDesk-0.5.3-win-x64.exe`，在目标 Windows 电脑安装。安装和原生桌面服务配置需要管理员授权。
2. 打开客户端，确认服务地址并开启远程控制。
3. 在另一台电脑用现代桌面浏览器打开同一服务地址，输入设备代码和连接密码。
4. 使用完成后，在客户端停止远程控制，或从托盘退出。

当前客户端预填项目现有服务地址，可直接在界面修改。长期使用建议[自行部署](docs/self-hosting.md)；现有服务不承诺公共托管容量或可用性。请勿在 Issue、截图或日志中公开连接密码。

安装包未配置代码签名。Release 同时提供 SHA-256 校验文件；Windows 可使用：

```powershell
Get-FileHash .\WebDesk-0.5.3-win-x64.exe -Algorithm SHA256
```

## 本地开发

需要 Node.js 22。Windows 客户端还需要 Visual Studio C++ 工具、Windows SDK 和固定版本 Flutter，详见[开发指南](docs/development.md)。

```sh
git clone https://github.com/ChrisDong-THU/WebDesk.git
cd WebDesk
npm ci
```

将 `.env.example` 复制为 `.env`，然后分别运行：

```sh
npm run server  # 信令：127.0.0.1:4300
npm run dev     # 网页：localhost:5173，代理到本机信令
```

Windows 客户端服务地址填写 `http://127.0.0.1:4300`。生产环境应使用 HTTPS，并配置正确的允许来源和 TURN 服务。

```sh
npm test
npm run build
npm run release:check
```

## 项目结构

```text
src/                 Vue 网页与上游适配
server/              认证、信令与静态资源服务
shared/              双端协议定义
desktop/flutter/    Flutter Windows 客户端
native/              桌面服务、输入、采集与音频桥接
build/inno/          Windows 安装器
scripts/             构建、来源校验和测试脚本
tests/               网页、协议与集成测试
third_party/         固定上游源码快照及许可证
deploy/              自部署示例与发布脚本
docs/                开发、架构与自部署文档
```

`electron-main/` 仅保留协议兼容测试适配器；Electron 和 nut.js 是开发依赖，**不进入 Flutter 安装包**。目录名称为保留上游提取路径兼容，并非另一套客户端。详见[架构与来源](docs/architecture.md)。

## 验证与限制

0.5.3 已通过 33 项 Node 测试、16 项 Flutter 测试、Windows Release 构建和公网 UDP TURN 协议回归。回归覆盖六档画质热调整、双向文件、剪贴板和输入消息；不等同于所有显卡、键盘布局或网络环境下的人工验收。

锁屏输入已在 Windows 实机验证。睡眠恢复、不同 Windows 安全策略、UAC 和特殊键盘布局仍需在目标环境验证；不承诺与官方 BilldDesk 的闭源版本具有相同性能。

## 参与贡献

请先阅读 [贡献指南](CONTRIBUTING.md)。普通问题使用 [Issues](https://github.com/ChrisDong-THU/WebDesk/issues)；安全问题参见 [安全策略](SECURITY.md)。版本变化见 [CHANGELOG](CHANGELOG.md)。

## 许可证与致谢

WebDesk 自有代码与所保留的 billd-desk 代码按 [MIT](LICENSE.txt) 分发。第三方组件沿用各自许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.md) 与 `third_party/licenses/`。感谢 billd-desk、Flutter、flutter-webrtc、WebRTC、Vue、Socket.IO 和 Inno Setup 的贡献者。
