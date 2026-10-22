# 开发指南

适用版本：0.5.9。本文说明代码结构、本地开发、测试和构建；服务器部署见[自部署指南](self-hosting.md)。

## 架构与来源

WebDesk 由浏览器主控端、Windows 被控客户端和信令服务组成。

```mermaid
flowchart LR
  B[Vue 浏览器端] <-->|认证与信令| S[Node.js / Socket.IO]
  W[Flutter Windows 客户端] <-->|注册与信令| S
  B <-->|WebRTC 媒体与数据通道，直连或 TURN 中继| W
  W --> N[Windows 原生服务与会话辅助进程]
  N --> D[桌面采集与输入]
```

| 目录 | 职责 |
| --- | --- |
| `src/` | 浏览器界面、WebRTC 连接、远程输入、文件与剪贴板 |
| `server/` | 设备注册、会话认证、信令转发和网页静态资源 |
| `shared/` | 通用协议定义与传输限制 |
| `desktop/flutter/` | Windows 界面、托盘、会话及媒体资源管理 |
| `native/windows/` | LocalSystem 服务、进程身份校验、命名管道、桌面切换与输入 |
| `native/flutter/` | 原生采集、系统声音桥接、依赖清单与补丁 |
| `third_party/` | 上游源码、来源清单与许可证 |
| `scripts/`、`tests/` | 构建、校验和测试 |
| `build/inno/`、`deploy/` | Windows 安装器与服务器部署配置 |

视频、音频、文件和剪贴板通过 WebRTC 传输，信令服务不接收这些内容。正常桌面使用原生 WebRTC 采集；安全桌面使用辅助进程提供的 BGRA 帧，在客户端转换为 I420。系统声音由独立的 WASAPI loopback 采集，默认关闭，不采集麦克风。

当前功能边界：

- 采集首个枚举显示器，未提供显示器选择界面。
- 最高画质档请求 4320p；实际分辨率和帧率受显示器、编码能力及网络影响。安全桌面采集最高 30 FPS。
- 工具通道使用 WebDesk tools v2，单个文件上限为 2 GiB。网页、服务端和客户端应同步更新。
- 锁屏和安全桌面控制依赖已安装的原生服务，仍需通过 Windows 登录认证。

### 连接恢复与媒体策略

浏览器串行处理信令，在远端 SDP 就绪前缓存最多 256 个 ICE 候选，协商失败交由会话层清理。短暂的媒体 `disconnected` 状态允许最多 15 秒自行恢复；`failed` 状态立即结束。恢复期间暂停浏览器键鼠输入，被控端释放已按下的键鼠。信令服务器断开仍结束当前会话；目前没有跨网络切换的 ICE restart 或会话续接。

原生端将 Answer 后的发送参数更新、实时画质调整和桌面切换放入同一串行队列。普通桌面采集不合成系统光标；安全桌面同样不绘制光标。桌面源明确标记为 screencast，关闭摄像头降噪。默认 `detail` 和 `text` 对应保分辨率的降级策略，`motion` 对应保帧率；当前映射不等于开启编码器专用的文本或无损模式。

普通桌面 BGRA → I420 转换使用实际 stride 和最多 4 个可复用缓冲区；只有编码器已经释放的帧才可重新写入。满载时丢弃新采集帧，避免改写编码中的帧。尺寸按宽、高分别匹配。采集周期扣除本次采集和转换耗时，避免每帧工作时间叠加到帧间隔。普通桌面上限 60 FPS，安全桌面上限 30 FPS；兼容接收旧客户端的 120 FPS 请求，但发送参数也按实际采集上限约束。

“自动码率”使用输出像素数 × 有效帧率 × 0.1 计算视频码率上限，限制在 2–32 Mbps；安全桌面按最多 30 FPS 计算。此策略避免未设置上限时单路 VP8 在高分辨率下仍使用 libwebrtc 约 2.5 Mbps 的默认上限。例如，1080p60 的自动上限约 12.44 Mbps，4K60 为 32 Mbps。它是上限策略，不是目标码率、最低保证或性能测量结果：实际速率仍由拥塞控制决定，手动选择的 1–16 Mbps 上限保持原值。

建立 Offer 前通过原生 `setCodecPreferences` 优先选择 AV1 → VP9 → VP8 → H.264，保留全部已报告的 profiles、RTX/RED/FEC 及其他候选。最终仍取双方支持的格式；偏好 API 不可用时使用平台默认顺序。依据是本仓库虚拟双端测量，不代表所有 CPU 上都具有同样收益，也不代表硬件编码。当前 Windows 构建的 VP8/VP9 使用 libvpx、AV1 使用 libaom、H.264 使用 OpenH264。浏览器统计分别显示 RTT、编码耗时、解码耗时和接收缓冲等待，不能把 RTT 当作操作响应延迟。

上游代码来源见 [billd-desk 清单](../third_party/billd-desk/manifest.json)、[billd-desk-server 清单](../third_party/billd-desk-server/manifest.json)和[原生依赖清单](../native/flutter/dependencies.json)。托盘插件保存在 `third_party/tray_manager/`，来源与修改范围记录于其 `upstream.json`。`electron-main/` 仅用于兼容测试，不属于发行客户端。许可证见[第三方声明](../THIRD_PARTY_NOTICES.md)，权限边界见[安全策略](../SECURITY.md)。

### 键鼠输入

网页通过 `src/core/controller-input.ts` 统一处理输入，使用可靠有序的数据通道发送。鼠标左右键和中键发送成对的按下/松开事件，双击由 Windows 根据两组事件识别；浏览器的 `click`、`dblclick` 和 `contextmenu` 不额外生成点击。按钮和滚轮操作前同步位置，拖出画面时将坐标限制在视频边界。

Windows 客户端串行处理输入，只合并相邻的鼠标移动，不跨越按键或按钮事件。页面隐藏、失焦、退出控制或连接关闭时释放输入状态。

键盘按物理键位传输，字符由远端布局和输入法决定。网页全屏时，`Esc` 退出全屏并释放本地键盘焦点；非全屏且视频获得焦点时，`Esc` 正常传给远端。浏览器或操作系统保留的快捷键、鼠标侧键、本地输入法的组合文本和 `Ctrl+Alt+Delete` 安全注意序列不在支持范围内。中文可使用远端输入法或文本剪贴板。

## 开发环境

| 开发范围 | 环境要求 |
| --- | --- |
| 网页与服务端 | Node.js 22、npm、Git |
| Windows 客户端 | Windows x64、Visual Studio 2022 C++ 桌面开发工具、Windows SDK 10.0.26100.0、.NET Framework 编译器 |
| 安装包 | 上述环境及 Inno Setup 6.7.3 |

Flutter、flutter-webrtc 和 libwebrtc 使用依赖清单固定的版本。准备脚本将 SDK 和构建缓存放在 `.tools/`，将 flutter-webrtc 检出到被 Git 忽略的 `third_party/flutter-webrtc/`。

以下命令均从仓库根目录执行，注明工作目录的命令除外。

### 网页与服务端

```sh
npm ci
```

复制 `.env.example` 为 `.env`，在两个终端分别启动：

```sh
npm run server
npm run dev
```

浏览器访问 `http://127.0.0.1:5173`；开发服务器将 `/socket.io` 代理到 `127.0.0.1:4300`。Windows 客户端服务地址填写 `http://127.0.0.1:4300`。环境变量说明见[自部署指南](self-hosting.md#服务配置)。

`npm run preview:ui` 可启动模拟界面预览，不建立真实远程连接。

### Windows 客户端

在 Windows PowerShell 中执行：

```powershell
npm run prepare:flutter
npm run dev:host
```

准备脚本下载固定依赖、应用原生补丁并配置插件目录联接。专用 libwebrtc 使用无硬件输入的音频模块，由独立系统声音源提供音频；构建过程会校验配方与二进制哈希。首次源码编译需要较多下载、磁盘空间和时间，后续构建复用通过校验的缓存。

仅运行 Dart 分析和单元测试时，可用下列命令代替完整准备：

```powershell
.\scripts\prepare-flutter.ps1 -SkipAudioBuild
```

此选项不准备可发布的原生音频库。开发程序也不能直接复用绑定到其他客户端路径的已安装桌面服务。

## 测试与验收

### 自动检查

```sh
npm test
npm run release:check
```

`npm test` 先校验上游提取代码、执行 TypeScript 检查并构建网页，再运行 Node 测试。`release:check` 检查客户端、服务端和锁文件的版本一致性。

完成依赖准备后，在 Windows PowerShell 中运行 Flutter 检查：

```powershell
$env:PUB_CACHE = Join-Path $PWD '.tools\pub-cache'
Push-Location desktop\flutter
try {
    ..\..\.tools\flutter\bin\flutter.bat analyze --no-pub
    ..\..\.tools\flutter\bin\flutter.bat test --no-pub
} finally {
    Pop-Location
}
```

原生回归测试：

| 命令 | 检查内容 |
| --- | --- |
| `.\scripts\test-flutter-task-runner.ps1` | 消息分发、并发任务、标题栏按钮与取消操作 |
| `.\scripts\test-tray.ps1` | 托盘菜单失焦关闭、重复打开、命令选择及主窗口保持隐藏 |
| `.\scripts\test-audio.ps1` | 系统声音启停、断开清理及麦克风会话释放 |

音频测试需先完成完整原生依赖准备，并在有可用音频设备的 Windows 实机运行；测试会播放短暂测试音。自动化检查不能替代实际 Explorer 托盘面板和远程会话验收。

### 发布验收

使用两台设备验证以下流程，并记录环境、结果和异常：

- 安装、升级、卸载；开启、停止和重新连接远程会话。
- 键鼠、画质切换、双向文件传输和文本剪贴板。
- 声音开关、断开后的音频释放，以及被控端本地音量与麦克风占用。
- 最小化、关闭到托盘、恢复窗口；菜单外点击、Esc 取消、菜单打开与退出。
- UAC、锁屏、解锁和睡眠恢复；直连与 TURN 中继下的连通性。

性能结果需注明分辨率、帧率、连接路径及 CPU/GPU 占用。`scripts/test-flutter-elevated.ps1` 是专用服务联调入口，需提前准备测试程序和本地控制端，并以管理员身份运行；它会临时更改服务绑定并在结束时恢复。锁屏测试需有人在场解锁。

媒体性能验收还应固定文本滚动、窗口拖动、视频和静态桌面四类画面，分别覆盖 1080p/2K/4K、30/60 FPS、1/4/8/16 Mbps、直连/TURN，以及延迟和丢包。记录接收分辨率、实际码率、帧率、编码耗时、质量限制原因、冻结次数和输入到画面响应延迟；RTT 不能替代端到端延迟。自动化状态机测试通过不能证明这些实机指标达标。

### 可复现的虚拟双端媒体测试

`scripts/test-desktop-capture.ps1` 将真实原生转换回调与确定性的桌面帧组合，验证旧帧持有期间不被改写、padding stride、等面积宽高变换、帧池上限、释放后恢复及空帧。发行构建必须通过该检查；补丁由 `build-libwebrtc.ps1` 纳入构建配方和哈希。

`test_driver/media_benchmark.dart` 是独立测试入口，不访问已安装的桌面服务。它绘制滚动文本、移动色块和输入挑战标记，以真实原生屏幕采集和编码发送到独立 Chromium 进程。接收端使用离屏渲染避免隐藏窗口的 1 Hz 节流。`tests/media-network.cjs` 重写 ICE 端口，使真实 RTP/RTCP/SCTP UDP 流量必须经过限速、延迟、丢包和有界队列；选中端口和转发计数会被验证。发送上限与网络瓶颈是两个独立参数，不使用 DevTools HTTP 限速冒充 WebRTC 限速。

准备完整依赖后，先构建测试入口，复制整个 Release 目录到独立测试目录，再复制已验证的 `.tools/webrtc-build/external-audio/libwebrtc.dll`。不要替换安装目录。设置 `WEBDESK_MEDIA_HOST` 为该目录的 `WebDesk.exe`、`WEBDESK_MEDIA_RESULTS` 为结果目录后运行：

```powershell
node scripts/run-electron.cjs scripts/test-media.cjs
node scripts/summarize-media.cjs test-results/media-benchmark/candidate.json
```

测试选项：`WEBDESK_MEDIA_VARIANT` 为结果前缀；`WEBDESK_MEDIA_CODECS` 为 `auto,VP8,H264,VP9,AV1` 中的逗号分隔列表；`WEBDESK_MEDIA_HEIGHT` 默认 1080、4320 表示允许原生高度；`WEBDESK_MEDIA_FPS` 默认 60；`WEBDESK_MEDIA_NETWORK_MBPS` 指定独立网络瓶颈（默认场景还包括发送上限 2/8 Mbps 和 2 Mbps、单程 20 ms、1% 丢包的网络）；`WEBDESK_MEDIA_RECEIVER_CODEC` 限制接收端格式用于回退验证；`WEBDESK_MEDIA_NATIVE_ORDER=1` 恢复平台协商顺序用于旧版对照。

测试会暂时置顶测试窗口，退出后关闭。出现防火墙提示时手动取消后重测；不得把被提示框调暗或被其他窗口覆盖的画面当作颜色失真结果。每场景预热 6 秒、测量约 12 秒，图案约每秒变化 30 次。结果包含实际 codec/encoder、编码与解码耗时、接收缓冲、帧率、冻结、颜色块 RMSE、输入挑战响应分布和原始 stats。颜色块误差不能替代文字或视频的全参考画质评价。

2026-10-22 在 i7-14650HX、Windows 11、3200×2000、Chromium 130 上的受控对比：固定 2 Mbps 时，修复后的 VP8/VP9/AV1 分别约 11.7/25.6/30.0 FPS，输入挑战中位响应约 241/135/139 ms；2 Mbps 网络瓶颈加单程 20 ms 与 1% 丢包时，AV1 约 30.8 FPS、249 ms。原始数据在本机 `test-results/media-current/`，早期 `baseline-059`/`fixed-capture` 因遮挡和后台节流作废，使用 `clean-*`、`native-*` 及后续最终验证结果。这是同机独立进程的媒体链路测试；不覆盖真实跨机 NAT/TURN、弱 CPU、长时间热降频、原生键鼠注入服务、UAC 和锁屏。输入挑战通过 DataChannel 改变测试图案，不冒充物理鼠标到屏幕的全链路实测。

## 构建与发布

### Windows 安装包

```powershell
.\scripts\setup-inno.ps1
npm run build:inno
```

构建会运行版本校验、原生回归、Flutter 分析和测试，使用生产入口 `lib/main.dart` 编译，并校验依赖、管理员清单和音频库。输出位于 `flutter-release/0.5.9/`：

- `WebDesk-0.5.9-win-x64.exe`：安装包。
- `WebDesk-0.5.9-win-x64.exe.sha256`：校验文件。
- `build.json`：构建信息及对应 payload 目录。

构建命令不安装应用。`npm run build:flutter` 仅生成程序目录；`npm run preview:installer` 预览安装界面。代码签名需由发行者配置。

### 服务端包

```sh
npm run package:server
```

输出为 `server-release/webdesk-<随机后缀>.tar.gz` 及同名 `.sha256` 文件，部署步骤见[自部署指南](self-hosting.md)。

### 维护规则

- 发布版本同步修改根目录和 `deploy/runtime/` 下的 `package.json`、`package-lock.json`，以及 `desktop/flutter/pubspec.yaml`；Flutter build number 随发布增加。
- 上游生成代码通过提取脚本维护，使用 `npm run upstream:check` 校验；原生插件修改保存为 `native/flutter/` 中的补丁，托盘插件修改保存在仓库内的源码中。
- 会话拥有其创建的连接、媒体、输入和工具资源；关闭流程禁止新操作，并在单项释放失败时继续清理其他资源。
- 提交依赖变更时同步锁文件、来源清单和许可证，不提交 SDK、缓存、测试产物或个人配置。

Linux CI 检查网页和协议并生成服务端包；Windows PR 检查 Flutter 和原生回归。Windows 安装包工作流在 `main` 分支匹配的文件变更或手动触发时运行。工作流上传构建产物，不自动发布 Release 或部署服务器。
