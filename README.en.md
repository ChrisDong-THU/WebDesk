<p align="center"><img src="src/assets/webdesk-icon.svg" width="80" alt="WebDesk"></p>
<h1 align="center">WebDesk</h1>
<p align="center">Your Windows desktop, within reach anywhere.</p>
<p align="center">
<a href="https://github.com/ChrisDong-THU/WebDesk/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/ChrisDong-THU/WebDesk"></a>
<a href="https://github.com/ChrisDong-THU/WebDesk/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ChrisDong-THU/WebDesk/actions/workflows/ci.yml/badge.svg"></a>
<a href="LICENSE.txt"><img alt="License MIT" src="https://img.shields.io/badge/license-MIT-green"></a>
<img alt="Windows x64" src="https://img.shields.io/badge/host-Windows%20x64-blue">
</p>
<p align="center"><a href="README.md">中文</a> · <a href="docs/development.md">Development</a> · <a href="docs/self-hosting.md">Self-hosting</a></p>

WebDesk lets you remotely control Windows from the web. The browser controller uses Vue and WebRTC; the Windows client uses Flutter, native WebRTC and a desktop helper service; the server uses Node.js / Socket.IO.

## Features

- Direct WebRTC connections, with a self-configured TURN relay when a direct connection is unavailable.
- Multiple quality presets adapted to the display's actual dimensions; adjust quality, bitrate and frame rate during a connection.
- Bidirectional file transfers, a text clipboard and optional system audio streaming.
- A native Windows service that supports switching to and interacting with the lock-screen desktop.

## Getting started

1. Download and install WebDesk from [Releases](https://github.com/ChrisDong-THU/WebDesk/releases/latest).
2. Open the client, confirm the server address and enable remote control.
3. Open the same server address in a modern desktop browser on another computer, then enter the device code and connection password.
4. When finished, stop remote control in the client or exit from the system tray.

The client currently pre-fills the project's existing server address. [Self-hosting](docs/self-hosting.md) is recommended for long-term use. Do not publish connection passwords in issues or logs.

Device codes and connection passwords are saved in the current Windows user's application data directory and reused across restarts. Use the regenerate button to the right of the copy/power buttons to replace both. Regeneration disconnects the current remote session and invalidates the previous credentials.

## Local development

Node.js 22 is required. Windows client builds also require Visual Studio C++ tools, the Windows SDK and a pinned Flutter version. See the [development guide](docs/development.md).

```sh
git clone https://github.com/ChrisDong-THU/WebDesk.git
cd WebDesk
npm ci
```

Copy `.env.example` to `.env`, then run these commands in separate terminals:

```sh
npm run server  # Signaling: 127.0.0.1:4300
npm run dev     # Web: localhost:5173, proxied to local signaling
```

Set the Windows client's server address to `http://127.0.0.1:4300`. Production deployments should use HTTPS with correctly configured allowed origins and TURN services.

```sh
npm test
npm run build
npm run release:check
```

## Project structure

```text
src/                 Vue controller and upstream adapters
server/              Authentication, signaling and static assets
shared/              Shared protocol definitions
desktop/flutter/     Flutter Windows client
native/              Desktop service, input, capture and audio bridges
build/inno/          Windows installer
scripts/             Build, provenance checks and test scripts
tests/               Web, protocol and integration tests
third_party/         Pinned upstream snapshots, manifests and licenses
deploy/              Self-hosting examples and release scripts
docs/                Development and self-hosting guides
```

`electron-main/` contains only protocol compatibility test adapters. Electron and nut.js are development dependencies and **are not included in the Flutter installer**. The directory name preserves compatibility with upstream extraction paths; it is not a separate client. See [architecture and provenance](docs/development.md#架构与来源).

## License and acknowledgments

WebDesk is distributed under the [MIT license](LICENSE.txt). Third-party components retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md) and `third_party/licenses/`. Thanks to the contributors of billd-desk, Flutter, flutter-webrtc, WebRTC, Vue, Socket.IO and Inno Setup.
