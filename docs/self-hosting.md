# 自部署

以下以一台 Linux 服务器、Node.js 22、systemd、nginx 和可选 Coturn 为例。云供应商不限。请使用自己的域名或有效证书支持的 IP 地址。

## 1. 构建

在开发机运行：

```sh
npm ci
npm run package:server
```

`server-release/` 生成 tar.gz 与 SHA-256。只包含网页、信令、协议、部署示例和最小运行依赖清单，不含 `.env`。使用 SSH/SCP 或你的部署工具上传；不要把服务器登录凭据提交到仓库。

## 2. 准备服务器

安装 Node.js 22、nginx，以及需要中继时的 Coturn。创建独立用户和目录：

```sh
sudo useradd --system --home /opt/webdesk --shell /usr/sbin/nologin webdesk
sudo install -d -m 755 /opt/webdesk/releases
sudo install -d -m 750 -o root -g webdesk /etc/webdesk
```

将 `.env.example` 的配置写入 `/etc/webdesk/webdesk.env`，权限设为 `root:webdesk 640`：

```dotenv
HOST=127.0.0.1
PORT=4300
ALLOWED_ORIGINS=https://desk.example.com
ICE_SERVERS=[]
```

配置自己的 HTTPS 来源。客户端和网页必须使用相同信令服务。空 ICE_SERVERS 适用于本地或具备直连条件的网络，不能保证公网可达。

安装 `deploy/webdesk.service` 为 `/etc/systemd/system/webdesk.service`，执行 `systemctl daemon-reload` 和 `systemctl enable webdesk`。首次启动在下一步发布后执行。

## 3. 发布

将 `deploy/activate-release.sh` 与构建归档上传后，使用真实版本、文件路径和 SHA-256：

```sh
sudo bash activate-release.sh 0.5.3 /tmp/webdesk-build.tar.gz ACTUAL_SHA256
```

脚本校验归档，安装最小依赖，原子切换 `/opt/webdesk/current`，重启服务并验证版本。切换会中断现有远控会话。升级失败时会尝试恢复之前的活动版本。

默认保留之前的发布目录。若需要在成功后删除全部旧版本，显式传入 `WEBDESK_PRUNE_RELEASES=1`：

```sh
sudo env WEBDESK_PRUNE_RELEASES=1 bash activate-release.sh 0.5.3 /tmp/webdesk-build.tar.gz ACTUAL_SHA256
```

清理仅作用于 `/opt/webdesk/releases/` 的普通子目录，保留当前版本；不删除 `/etc` 配置、证书或其他目录，不创建备份。成功后可删除上传的 tar.gz。

## 4. HTTPS 与 TURN

参考 `deploy/nginx.conf.example`，替换 hostname 和证书路径，运行 `nginx -t` 后重载。只公开 HTTPS 端口，不将信令 4300 端口直接暴露到公网。

直连失败时参考 `deploy/turnserver.conf.example`：替换公网/私网 IP、realm、证书和强随机 TURN 凭据。在防火墙与云安全组中开放实际使用的监听和 UDP 中继端口范围。保留示例中的配额及内网目的地址限制。

在 `/etc/webdesk/webdesk.env` 中将 ICE_SERVERS 设置为单行 JSON，例如：

```dotenv
ICE_SERVERS=[{"urls":["stun:turn.example.com:3478","turn:turn.example.com:3478?transport=udp"],"username":"webdesk","credential":"YOUR_RANDOM_TURN_SECRET"}]
```

重启 WebDesk 后生效。静态 TURN 凭据会提供给授权会话，建议按需轮换并监控流量。不要使用本仓库的占位值作为真实凭据。

## 5. 验证与运维

- `curl --fail https://desk.example.com/health` 应返回正确版本，且证书验证通过。
- 检查 `systemctl status webdesk nginx coturn`，用 `journalctl -u webdesk` 排查服务错误。
- 用两台授权设备测试连接、键鼠、文件、剪贴板与声音，检查实际连接路径。TURN 中继受服务器带宽上限影响。
- 在目标 Windows 环境实测锁屏、解锁和睡眠恢复。
- 自行配置证书续期和必要监控；本仓库不包含云账号、生产密钥或专用运维脚本。
