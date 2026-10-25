# BilldDesk 编码选择复核与 WebDesk 自动策略

## 本次结论

撤销 r3 的双端固定 H.264 优先。用户需要多编码按情况选择；上一轮把“同 H.264 实现回退”扩大成“所有会话优先 H.264”，不符合这个目标。

本轮已从实际 Dart AOT 执行代码恢复出 BilldDesk 的**启用集合与排序配置 → 能力协商 → 所选 codec 的实现选择与故障回退**链路。没有恢复出按网络、CPU、画质给所有 codec 打分的算法，因此不能声称复刻了这种算法。WebDesk 的运行压力闭环是独立实现的扩展。

## BilldDesk 已确认的选择链路

| 步骤 | 证据与含义 |
| --- | --- |
| 应用候选 | `videoCodecs` 与 `videoCodecsSort` 按逗号拆分，取启用交集并保持排序配置的顺序。Dart routine 文件 offset `0x7c46f0–0x7c4898`，过滤 routine `0x541e6c`。异常后备列表为 H265→H264→AV1→VP9→VP8，再接音频格式；后备列表不等于有效运行默认。 |
| SDP 协商 | Offer 与 Answer 路径均调用 `0x53fdb4`。按 codec 名选多个 payload，关联 RTX/apt，保留入选 fmtp 原行。它实际影响 SDP，超出了“字符串中存在排序字段”的证据。 |
| 硬件能力 | 原生 aggregate factory 按硬编总开关、NVIDIA/AMD 顺序收集经过设备探测的格式，再追加软件格式。NVENC 分别探测 H264/H265/AV1，不能因 DLL 包含名称就认为当前设备支持。 |
| 实现回退 | 为已请求的 codec 创建兼容硬编；H.264 内部与 AV1 外层都存在同 codec 软件后备。原生失败分支还能请求 VP8 兜底，不应删除兼容故障出口。 |
| 统计 | `reqCodecInfo/resCodecInfo` 链查询活动编码器与编码耗时，更新统计 UI。没有找到从这条已恢复的统计链直接重排 codec 的调用。所查 factory 的 GetEncoderSelector 返回空。 |

实际运行的 `D:\BilldDesk\BilldDesk.exe` v0.609.0 设置界面也交叉验证了五种视频 codec 勾选列表。当前本机配置全部启用，网络为低延迟、降级为保分辨率、1080p60；这些是**当前设置**，没有改动，也没有据此认定出厂默认。没有建立 BilldDesk 远控会话。

可复核证据：

- [Dart 执行代码与对象池解析](evidence/billd-codec-selection-dart-20261025.json)：577 个 allocation cluster、90,044 个引用、唯一 34,260 项 global pool；38 段字节/指令范围与分析产物哈希。补充 Python/Capstone 解析，**不是 REA 深层反编译**；保留原始 REA section-layout Evidence 引用。
- [原生 factory、硬件探测及回退](evidence/billd-codec-selection-native-20261025.json)：原始 REA 身份证据和明确标注的补充 Capstone 分析，含 RVA、SHA256、范围及未知项。
- [实际设置界面观察](evidence/billd-codec-settings-runtime-20261025.json)：Computer Use 只读导航；不是 REA runtime capture。

远端默认配置接口存在实际调用，但本轮未取得其返回值、有效字段覆盖顺序或 BilldDesk 会话 SDP；不将未知配置说成固定默认。

## WebDesk 的最终行为

网页默认“编码：自动”，清除旧的固定接收偏好，尊重主机 Offer。也可选择 H.264、AV1、VP9 或 VP8 **首选**；未支持时使用协商后备。主机和浏览器都保留实际 capability 对象、全部 profile 与 repair 格式，由 WebRTC 做 fmtp/profile/RTX 匹配，不照搬手写 SDP 过滤器。

自动策略先按用户目标和可用实现建立候选顺序：桌面细节/清晰场景先考虑 AV1；低延迟、motion 或流畅优先先考虑 H.264；实际 H.264 硬编探测结果还影响后备顺序。它们是可解释的产品先验，**不是跨设备通用性能排名**。没有共同 AV1 时自然落到其他能力；不能只看 codec 名判断硬编。

会话运行中，主机采样真实编码器、递增编码帧数、每帧编码耗时、quality limitation、带宽与丢包；网页每约两秒回传实际接收 codec、interval 解码耗时/FPS/缓冲和累计冻结/丢帧统计。当前 codec 策略使用新鲜的解码耗时/FPS；累计冻结/丢帧不会被错误地当成一个采样周期的故障次数。

连续四个有效样本确认编码或解码受压后，自动模式才尝试另一共同支持的编码；持续六个有效的干净链路带宽受限样本，可试更高压缩效率的候选。已在 AV1 时，不会仅因带宽受限换到 VP9。丢包本身交由拥塞控制和既有画质预算处理，不反复切编码。

切换至少预热六秒，两次自动尝试间至少 45 秒；同一设置上下文最多有界尝试三个其它候选，不重复试探已失败的候选。静态低 FPS、缺失数据、计数器重置、旧 codec 解码反馈与恢复中的 ICE 不触发试探。手动首选不被压力策略改成别的首选；原生同 codec 的实现回退仍可发生。用户改变分辨率/FPS/码率、内容/降级/网络目标或首选后重新评估，避免把旧工作负载的失败永久套用到新设置。

切换复用既有串行协商、negotiation ID 和 ICE 世代过滤。主机采集路径也随实现考虑：软件编码先用 CPU 早缩放；从纹理路径转软件 codec 时关闭无益的 texture readback，同 peer/音频/工具通道不重建。能力探测、选择原因、候选顺序、实际切换数和冷却时间可在状态栏编码字段的悬浮信息中查看。

## 验证与性能边界

截至旧客户端兼容修复，检查通过：94 项 Node 测试、92 项 Flutter 测试、Flutter 静态分析、51 项原生采集、9 项 NVENC、3 个独立进程初始化顺序、6 项 MF，以及任务队列、托盘和标题栏输入回归。原生 DLL/插件本轮未改；构建入口固定为 `lib/main.dart`，不是媒体测试入口。

浏览器真实 RTP 测试已验证初轮和后续 AV1→VP9→H264→VP8，手动首选、回到自动、VP8-only 对端与缺少偏好 API 的兼容行为；peer/音频保持、工具通道仅一个，接收反馈真实到达 MessageChannel。结果在 `test-results/browser-video-codecs/result.json`。

隔离 Windows 原生采集 → Chromium 会话验证初始自动 AV1，随后 H264→VP9→VP8→AV1→自动；每一步实际发送与解码的 RTP codec 均符合结果，轨道/peer/通道未重建。结果在 `test-results/codec-auto-20261025/native-renegotiation-reused-host.json`。首次新测试路径遇到防火墙提示遮挡，已被画面有效性校验拒绝；改用已有隔离测试路径，没有改防火墙设置。

额外用同一 DLL、同一 CPU 采集路径、实际 1728×1080、30 FPS 动画与采集上限、2 Mbps 码率上限、相同不主动降分辨率/FPS 设置，做了正反顺序两轮比较。无额外网络限速/延迟/丢包，以下范围为两轮单次短测，不能当作置信区间：

| 编码/实际实现 | 接收 FPS | 编码 ms/帧 | 输入中位数 ms | 输入 P95 ms | 冻结 |
| --- | ---: | ---: | ---: | ---: | ---: |
| AV1 / libaom | 27.96–28.76 | 6.18–6.92 | 115.5–134.6 | 135.3–200.3 | 0 |
| H264 / NVENC CPU-NV12 | 24.76–25.85 | 7.63–7.69 | 107.1–114.0 | 155.8–177.6 | 0 |
| VP9 / libvpx | 24.12–25.57 | 8.49–8.97 | 129.2–136.1 | 157.5–163.1 | 0 |
| VP8 / libvpx | 21.38–22.54 | 4.16–4.25 | 97.2–158.2 | 143.8–226.2 | 0 |

原始数据为同目录 `same-path-30fps-round1.json`、`same-path-30fps-round2.json`，各有 summary。AV1 在本机这组条件下保留更高接收 FPS；H264 中位延迟更低。不能把色块 RMSE 说成文字感知质量，也不能据此断言某 codec 全指标最好。测试在 Windows Chromium 130 本机链路，**Mac Chrome 公网性能和画质仍待实测**。本轮没有新增 AV1/VP9 硬编实现；当前 AV1 实际为 libaom，未达到 BilldDesk 所有供应商/codec 的硬编覆盖。

## 部署

新版网页已通过 Workbench 原子部署至 `https://120.55.241.162`，候选 `/opt/webdesk/media-candidates/20261025-codec-auto-205e87f0997f`，同目录 `previous-live` 可回退，旧散列资源保留。公网 HTML/JS/CSS 哈希一致；服务 PID 40824 保持，无重启。HTML SHA256 `c424ff3947985b74b9c3497c32d2312f48df9276b9e72885a12b927be52d0506`。

自动策略主机端需 `flutter-release/media-alignment-20261025/WebDesk-0.5.9-media-auto-r4.exe`，SHA256 `bbd40d6553003b8b48ebc00576ac9d8199190f69dd95fd9083a0eaa372c9efd8`；正式载荷为 `payload-d82a597d01894962b6b44dfeb4631b5d`。旧 r2/r3 可以继续连接，但不会因新网页就获得主机的运行压力策略。完整精确产物与检查结果以同目录 `deployment.json` 为准。

用户已表示可以开始 Mac Chrome 联测，实际结果待回传。安装后强制刷新并重连，统一 1080p、30 FPS、8 Mbps、清晰优先、传输自动，先测编码自动，再切 AV1/H264 首选并回到自动，记录实际编码器、FPS、选择原因与体感。尚未替用户安装 r4，也未据本机测试宣称公网画质和性能已对齐 BilldDesk。

## 后续修复：旧客户端忽略编码设置

用户随后报告无论选什么都显示 VP8。只读检查发现：`D:\WebDesk\data\app.so` SHA256 仍为 `5c8b510a4f54b1fa63fdb735a3d9d611d13e2a04a6612957d92a9eec988a20e2`，匹配 r2，和 r4 的 `a7d8a45824f9cd277ad420a3ce5cc5ae25a3a74b0b57317bb5670c027af57c64` 不同；服务登记的客户端路径为 `D:\WebDesk\WebDesk.exe`。唯一已见 WebDesk 进程 PID 26128 自 14:22:21 启动，早于 r4 构建。CIM 未能读取该管理员进程的 ExecutablePath，未将空字段当成直接进程路径证据。这组检查不能说明用户为何未更新成功，但说明不能假设 r4 已在当前路径生效。

直接兼容缺陷是网页只发送 `changeVideoCodec`，r2 不识别该消息，也不产生新 Offer；浏览器虽然记住首选，却没有下一次 Answer 来应用它。此前隔离测试验证了新主机重协商和首轮能力交集，没有覆盖 useSession 面对旧主机时的静默忽略。

修复后，网页从实际 `media.stats` 回复读取 `codecPolicy` 能力：确认支持实时选择时保持原会话；旧版或尚未确认能力时，编码首选变化会结束旧授权会话、复用内存中的连接信息重新认证，并在新会话首次 Answer 应用首选。页面显示应用编码的重连状态及旧客户端能力说明。手动断开可以取消重连，普通画质参数不会因此重连。旧客户端的自动策略仍需升级，不能通过网页假装补齐主机运行时策略。

验证补充：94 项 Node 测试通过，含旧会话结束、新连接携带首选、新版保持原 peer、取消重连等；真实浏览器工具通道分别返回新版/旧版能力，并验证 VP8-first Offer 的首次 AV1 Answer 与实际 AV1 RTP。另用与安装目录相同 SHA256 的原生 DLL，在隔离测试路径保留平台 VP8-first Offer，由接收端选 AV1，实际结果为 `video/AV1`，无测试错误。原始数据：`test-results/codec-legacy-fix-20261025/vp8-offer-av1-answer.json`，完整浏览器结果为 `test-results/browser-video-codecs/result.json`。这不等于已观察用户 Mac 的新会话。

最新网页已部署至 `/opt/webdesk/media-candidates/20261025-codec-legacy-459738887f30`，同目录 `previous-live` 保留上版；公网 HTML SHA256 `5397dfc0750a6d10276a2ff9af1ccbedcb631dd5c52c6d210b612f15123fdd77`，JS/CSS 哈希一致，服务仍为 PID 40824，无重启。客户端安装包仍是上面的 r4，没有为网页兼容修复另造安装包。用户在 Mac Chrome 强制刷新后，可先用现有旧客户端验证 AV1/H264 首选重连生效；完整实时自动策略需要 r4 实际安装并运行。

随后用户在真实 Mac Chrome 公网会话中明确反馈“重连后已变为 AV1”。据此，旧客户端首选切换的公网兼容路径已获用户验证，不再只是本机隔离测试。此证据是用户观察状态栏的反馈，没有独立抓取该会话 SDP/RTP；尚不能说明画质、滚动延迟已改善，或 r4 的会话内自动选择策略已在 Mac 公网验证。
