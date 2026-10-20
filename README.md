<p align="center"><img src="src/assets/webdesk-icon.svg" width="80" alt="WebDesk"></p>
<h1 align="center">WebDesk</h1>
<p align="center">让 Windows 桌面随处可达</p>
<p align="center">
<a href="https://github.com/ChrisDong-THU/WebDesk/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/ChrisDong-THU/WebDesk"></a>
<a href="https://github.com/ChrisDong-THU/WebDesk/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ChrisDong-THU/WebDesk/actions/workflows/ci.yml/badge.svg"></a>
<a href="LICENSE.txt"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-green"></a>
<img alt="Windows x64" src="https://img.shields.io/badge/host-Windows%20x64-blue">
</p>
<p align="center"><a href="README.en.md">English</a> · <a href="docs/development.md">开发指南</a> · <a href="docs/self-hosting.md">自部署</a></p>

WebDesk 通过 Web 端对 Windows 远程控制。浏览器端使用 Vue 与 WebRTC，Windows 客户端使用 Flutter、原生 WebRTC 和桌面辅助服务，服务端使用 Node.js / Socket.IO。

## 功能

- WebRTC 直连；无法直连时使用自行配置的 TURN 中继。
- 多档位画质，按屏幕实际尺寸适配；画质、码率、帧率可在连接中实时调整。
- 双向文件传输、文本剪贴板、可选系统声音传输。
- 原生 Windows 服务支持锁屏桌面切换与输入。

## 开始使用

1. 从 [Releases](https://github.com/ChrisDong-THU/WebDesk/releases/latest) 下载并安装。
2. 打开客户端，确认服务地址并开启远程控制。
3. 在另一台电脑用现代桌面浏览器打开同一服务地址，输入设备代码和连接密码。
4. 使用完成后，在客户端停止远程控制，或从托盘退出。

设备代码和连接密码会保存在本机当前 Windows 用户的应用数据目录，重启客户端或重新开启远程控制时保持不变。点击复制/开关按钮右侧的“重新生成”可同时更换两者；当前远程会话会断开，旧连接信息随即失效。

当前客户端预填项目现有服务地址，长期使用建议[自行部署](docs/self-hosting.md)，请勿在 Issue 或日志中公开连接密码。

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
desktop/flutter/     Flutter Windows 客户端
native/              桌面服务、输入、采集与音频桥接
build/inno/          Windows 安装器
scripts/             构建、来源校验和测试脚本
tests/               网页、协议与集成测试
third_party/         固定上游源码快照、校验清单及许可证
deploy/              自部署示例与发布脚本
docs/                开发与自部署指南
```

`electron-main/` 仅保留协议兼容测试适配器；Electron 和 nut.js 是开发依赖，**不进入 Flutter 安装包**。目录名称为保留上游提取路径兼容，并非另一套客户端。详见[架构与来源](docs/development.md#架构与来源)。

## 许可证与致谢

WebDesk 按 [MIT](LICENSE.txt) 分发。第三方组件沿用各自许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.md) 与 `third_party/licenses/`。感谢 billd-desk、Flutter、flutter-webrtc、WebRTC、Vue、Socket.IO 和 Inno Setup 的贡献者。
