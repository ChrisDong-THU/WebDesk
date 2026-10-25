# WebDesk 首轮 VP8 问题与 H.264 策略修正

本文保留 r3 的历史调查和交付。用户后续明确需要多 codec 自动选择，r3 的双端固定 H.264 优先已撤销；最新执行代码证据、自动策略、同条件对照和交付见 [多编码自动选择](webdesk-auto-codecs-20261025.md)。本页的“Billd 默认顺序未知”也已由后续解析进一步缩小为“配置顺序及异常后备已恢复，有效远端配置仍未知”。

## 结论

用户在 Mac Chrome 公网连接时，刚建立会话即显示 VP8。已核对本机服务指向 `D:\WebDesk`，安装文件匹配 r2 候选包，排除这组安装文件仍为旧候选的情况。

源码中存在两条可解释 VP8 的路径：主机仅在硬编探测成功时优选 H.264，否则优选 VP8；网页生成首轮 Answer 时没有设置接收 codec 偏好。此外，原自适应逻辑会在编码耗时持续偏高时将 H.264 标为昂贵 codec 并重新协商。这些是确认存在的代码行为；尚未取得用户这次 Mac 会话的 Offer、Answer 和探测结果，不能断言具体是哪一次硬编探测失败造成首轮 VP8。

## BilldDesk 安装包证据

目标为 `D:\BilldDesk\libwebrtc.dll`，SHA256 `9d7933cc2eefe111502e7ef5aef23a07a943209590ffb781d3f494149d7392c1`。本轮 REA 符号复核完整且未截断，但符号列表为空；深层反编译 provider 不可用。下面的原生控制流来自 PE unwind 辅助定位及 Capstone 补充反汇编，不能称作 REA 恢复出的源码。原始引用、地址及限制见[证据记录](evidence/billd-nvenc-factory-focus-20261025.json)。

- NVENC 初始化失败后调用同 H.264 的软件实现：RVA `0x56595d → 0x565140 → 0x750610`。这支持将编码实现回退与线上的 codec 协商分开处理。
- H.264 初始化路径在 RVA `0x562cfd–0x562d25` 将 GUID `e7cbc309-4f7a-4b89-af2a-d537c92be310` 写入 NVENC profile 字段，对应 H.264 High。它证明这一初始化路径的设置，不证明产品默认选 H.264、实际输出 SPS，或所有接收端均支持 High。
- 软件 SetRates 转交活动实现；NVENC 路径更新码率/FPS 后重配。未安全恢复出所有降级阈值。
- Dart 常量有 `videoCodecsSort`、`getCodecs`、`reqCodecInfo`、`resCodecInfo`、`updateCodecInfo` 以及远端 `default_rtc_config`。常量物理顺序不能证明默认 codec 优先级。本轮没有观察 BilldDesk 真实会话，默认 codec 仍未知。

## 已迁移的机制

1. 主机和网页接收端均采用 H.264 → AV1 → VP9 → VP8 的能力偏好，保留原始全部 profile、repair capability 和对象，不删改 SDP。由双方能力决定最终结果；浏览器不支持偏好 API 时安全保留平台顺序。
2. 硬编探测只决定实现与采集路径，不再决定是否优选 H.264。原生仍按 NVENC → MF → OpenH264 保持同 codec 回退；所有 H.264 实现均失败时，保留 WebRTC 自身的兼容/故障回退。
3. H.264 高编码耗时只进入已有负载预算调整，不再因此跨 codec 降到 VP8。GPU 等待也计入 Encode 耗时，不能据此认定软件 CPU 编码。AV1/VP9 的有界昂贵 codec 调整仍保留。
4. 未确认硬编时先用 CPU 早缩放，避免软件 H.264 不必要的 texture readback。运行中确认 OpenH264 且纹理读回持续昂贵时，可按既有迟滞在同轨道内切换一次 CPU 路径。
5. 首轮 Answer 和重复 Offer 都设置接收偏好，保留同一个 peer、音频和工具通道。主机媒体统计新增 `codecPolicy`、`codecPreferenceApplied` 和 `hardwareH264Available`。

没有在 Baseline SDP 下强塞 High Profile；WebDesk 仍使用原生 factory 与浏览器实际公布的 profile。提升文字保真还受码率、缩放、色度采样和网络预算影响，不能仅凭 codec 名认定画质已与 BilldDesk 相同。

## 验证

- 86 项 Node 测试、85 项 Flutter 测试、Flutter 静态分析及正式网页/客户端构建通过。原生 DLL 和插件本轮未变，之前的原生测试结果保留。
- 真实 Chromium/生产 Runtime 互操作：VP8 在首位且包含六组 H.264 profile 的 Offer，首轮和重复 Answer 均选 H.264；仅 VP8 的 Offer 可继续 VP8；偏好 API 缺失可继续连接。测试确认没有重复工具通道或 transceiver，音频及 peer 身份保持。结果：`test-results/browser-video-codecs/result.json`。
- 显式禁用硬编后，真实原生采集 → Chromium 自动协商仍为 H.264/OpenH264，1728×1080，未转 VP8。结果：`test-results/billd-alignment/h264-first-software.json`。
- 硬编启用的 60 FPS 动画测试实际使用 `WebDesk-NVENC-H264-CPU-NV12`；接收平均 35.94 FPS、四次冻结共 0.97 秒。测试时存在并行构建负载，不用它比较性能优劣，也不表示 Mac 公网可以稳定 60 FPS。结果：`test-results/billd-alignment/h264-first-hardware-60fps.json`。

## 交付

网页已在 `https://120.55.241.162` 原子切换，无服务重启。候选 `/opt/webdesk/media-candidates/20261025-codec-182c2dc6adeb`；其 `previous-live` 保存上一版 HTML/许可证，旧散列资源保留。公网 HTML/JS/CSS 与本地候选的 SHA256 一致。HTML SHA256 `827689caa92eb757910729b5a5eb0ee0001b6e1d42608d6feea0027562cabaa1`。

Windows 正式入口 `lib/main.dart` 的新候选为 `flutter-release/media-alignment-20261025/WebDesk-0.5.9-media-codec-r3.exe`，SHA256 `f58a8152867ce46d868e8ca8bd62b392bf9c5dbd09aedadb30ee2e57a5b0e495`。旧安装文件及候选包保留；r3 尚需用户安装。Mac 先可用 r2 客户端强制刷新网页、断开重连，验证网页能否从其 Offer 中选择 H.264。用户的这次 Mac 实际协商及画质反馈仍待取得。
