# 贡献指南

欢迎提交可复现的问题和聚焦单一目标的 Pull Request。较大的架构变动请先创建 Issue 讨论。

## 提交前

1. 阅读 [开发指南](docs/development.md) 和 [架构说明](docs/architecture.md)。
2. 从 `main` 新建分支，遵循 `.editorconfig` 和现有代码风格。
3. 运行 `npm test`、`npm run build`、`npm run release:check`。修改 Flutter 时另运行 `flutter analyze`、`flutter test`；涉及原生输入或采集的修改须提供 Windows 实测情况。
4. 在 PR 中描述问题、修改后行为和实际验证结果；界面修改附无敏感信息的截图。

不要提交凭据、`.env`、SDK 缓存、node_modules、安装包、部署日志或真实设备连接信息。二进制交付放在 Release。

## 上游与原生代码

- 不直接修改生成的 `src/billd/`、`electron-main/billd/`、`server/billd/`；修改提取脚本或外围适配，并运行来源检查。
- `third_party/billd-*` 是固定版本的最小源码快照，升级需要同时更新 revision、清单和署名。
- flutter-webrtc 修改以 `native/flutter/flutter-webrtc.patch` 保存，不能依赖本地忽略目录里的未记录改动。
- 原生服务以 LocalSystem 运行。修改权限、管道校验、桌面绑定、会话退出时，必须说明权限边界和失败时的清理行为。

新增依赖应说明必要性、许可证和对安装包体积的影响。提交贡献即表示你有权按本项目 MIT 许可贡献该代码；第三方代码须保留其许可证与来源。

请尊重参与者，围绕代码和可复现事实讨论，不发布他人的私人信息。
