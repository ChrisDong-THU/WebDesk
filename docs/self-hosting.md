# 自部署指南

适用版本：0.5.7。以下方案使用 Linux、Node.js 22、systemd 和 Nginx；需要公网中继时配置 Coturn。网页、服务端和 Windows 客户端应同步更新，并连接同一服务地址。

## 构建与上传

在开发机仓库根目录执行：

```sh
npm ci
npm run package:server
```

输出为 `server-release/webdesk-<随机后缀>.tar.gz` 和同名 `.sha256` 文件。归档包含网页、信令代码、协议、许可证、部署示例和运行依赖清单；不包含 `.env` 或 `node_modules`，部署时需访问 npm registry 安装依赖。

上传以下文件到服务器 `/tmp/`：

- 生成的 `.tar.gz` 和 `.sha256` 文件。
- [activate-release.sh](../deploy/activate-release.sh) 和 [webdesk.service](../deploy/webdesk.service)。
- [nginx.conf.example](../deploy/nginx.conf.example)；需要中继时再上传 [turnserver.conf.example](../deploy/turnserver.conf.example)。

`activate-release.sh` 不在构建归档中，需单独上传。

## 准备服务器

安装 Node.js 22、npm、Nginx、curl 和 tar，确保可使用 systemd、`flock` 和 `sha256sum`。服务模板使用 `/usr/bin/node`，安装路径不同时需修改 `ExecStart`。

首次部署时创建运行用户和目录：

```sh
sudo useradd --system --user-group --home-dir /opt/webdesk --shell /usr/sbin/nologin webdesk
sudo install -d -m 755 /opt/webdesk/releases
sudo install -d -m 750 -o root -g webdesk /etc/webdesk
```

## 服务配置

创建 `/etc/webdesk/webdesk.env`，填写：

```dotenv
HOST=127.0.0.1
PORT=4300
ALLOWED_ORIGINS=https://desk.example.com
TRUSTED_PROXIES=127.0.0.1,::1
ICE_SERVERS=[]
```

将 `desk.example.com` 替换为实际域名，并设置权限：

```sh
sudo chown root:webdesk /etc/webdesk/webdesk.env
sudo chmod 640 /etc/webdesk/webdesk.env
```

| 配置项 | 含义 |
| --- | --- |
| `HOST` | Node 监听地址；本机 Nginx 代理时使用 `127.0.0.1` |
| `PORT` | Node 监听端口；部署脚本和代理模板均使用 `4300` |
| `ALLOWED_ORIGINS` | 允许访问的网页来源，多个来源以逗号分隔；填写协议、主机及非默认端口，不含路径 |
| `TRUSTED_PROXIES` | 直接连接 Node 的可信代理 IP；支持精确 IPv4/IPv6 地址，以逗号分隔，不支持网段；无代理时留空 |
| `ICE_SERVERS` | 单行 JSON 数组，配置 STUN/TURN；空数组仅适用于具备直连条件的网络 |

Nginx 必须覆盖客户端提交的 `X-Real-IP`，使用模板中的 `proxy_set_header X-Real-IP $remote_addr`。多层代理需先在可信入口配置真实地址解析。

安装 systemd 单元，暂不启动：

```sh
sudo install -m 644 /tmp/webdesk.service /etc/systemd/system/webdesk.service
sudo systemctl daemon-reload
sudo systemctl enable webdesk
```

## 发布与升级

将下例归档路径替换为实际上传文件；同名 `.sha256` 文件应位于同一目录：

```sh
archive=/tmp/webdesk-XXXXXX.tar.gz
digest=$(awk '{print $1}' "$archive.sha256")
sudo bash /tmp/activate-release.sh 0.5.7 "$archive" "$digest"
```

脚本依次校验 SHA-256 和包版本、安装运行依赖、切换 `/opt/webdesk/current`、重启服务，并检查本机 `/health` 的状态和版本。脚本健康检查固定使用 `127.0.0.1:4300`，更改监听配置时需同步调整。

升级会中断现有远控会话。激活失败时，脚本尝试恢复先前版本；首次部署失败则停止服务。默认保留发布目录供检查和回退。可选环境变量 `WEBDESK_PRUNE_RELEASES=1` 会在成功后删除全部旧发布目录。

修改 `webdesk.env` 后运行 `sudo systemctl restart webdesk`；修改 systemd 单元后还需先执行 `sudo systemctl daemon-reload`。

## HTTPS 访问

将 Nginx 示例安装到发行版使用的配置目录，替换域名和证书路径。示例中的 `map` 与 `server` 块须位于 Nginx 的 `http` 上下文。

```sh
sudo nginx -t
sudo systemctl reload nginx
```

对外开放 HTTPS 443 端口，Node 4300 端口仅供本机代理访问。自行配置有效证书和续期；示例不包含 HTTP 跳转或证书申请流程。

## TURN 中继

无法直连的网络需要 TURN。安装 Coturn 后，根据示例替换监听地址、中继地址、公私网地址映射、域名、证书和随机密码；保留配额与内网目标地址限制。

按所启用的协议在防火墙和云安全组开放端口：

| 端口 | 用途 |
| --- | --- |
| `3478/UDP`、`3478/TCP` | STUN/TURN 监听 |
| `5349/TCP` | TURN over TLS，使用时开放 |
| `49160–49200/UDP` | 示例配置的中继端口范围 |

在 `webdesk.env` 中配置 ICE 服务，例如：

```dotenv
ICE_SERVERS=[{"urls":["stun:turn.example.com:3478","turn:turn.example.com:3478?transport=udp"],"username":"webdesk","credential":"YOUR_RANDOM_TURN_SECRET"}]
```

替换域名和密码，使其与 Coturn 配置一致；启动或重启 Coturn 后，重启 WebDesk。此示例使用 UDP；需要 TLS 中继时配置与证书域名一致的 `turns:` 地址。静态 TURN 凭据会提供给授权会话，应定期轮换并监控中继流量。

## 部署验收

```sh
curl --fail https://desk.example.com/health
sudo systemctl status webdesk nginx
sudo journalctl -u webdesk -n 100 --no-pager
```

健康接口应返回 `status: "ok"` 和 `version: "0.5.7"`。启用 Coturn 时另查其服务状态。

使用两台设备验证连接、键鼠、双向文件、文本剪贴板和声音；在无法直连的网络验证 TURN 中继，并检查实际连接路径。Windows 客户端的托盘、UAC、锁屏与恢复验收见[开发指南](development.md#发布验收)。

健康检查只确认 HTTP 服务状态，不能证明远程连接、媒体或输入功能正常。
