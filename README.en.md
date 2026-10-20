# WebDesk

**Control a Windows desktop from your browser.**

[中文](README.md) · [Downloads](https://github.com/ChrisDong-THU/WebDesk/releases/latest) · [Development](docs/development.md) · [Self-hosting](docs/self-hosting.md)

WebDesk combines a Vue browser controller, a Flutter Windows host, native WebRTC and a Node.js/Socket.IO signaling server. It is an independent MIT-licensed derivative of [billd-desk](https://github.com/galaxy-s10/billd-desk) and [billd-desk-server](https://github.com/galaxy-s10/billd-desk-server), not an official BilldDesk product or a copy of its proprietary client.

## Features

- Mouse and keyboard control, punctuation and key combinations.
- WebRTC direct connections with configurable TURN fallback.
- Six quality presets (360p to 8K), bounded by the actual display; live bitrate and frame-rate changes.
- Bidirectional files, text clipboard, optional system audio and video-only fullscreen.
- Windows tray integration and a native service for lock-screen desktop capture/input.

## Download

Get the Windows x64 installer and SHA-256 checksum from [Releases](https://github.com/ChrisDong-THU/WebDesk/releases/latest). Administrator permission is required to install/configure the native service. The installer is currently unsigned.

Start the Windows host, check its server address and enable remote control. Open the same address in another desktop browser and enter the device code and connection password. The client pre-fills the project's existing endpoint, but it is editable; self-host for long-term use. No public hosting SLA is provided.

## Develop

Node.js 22 is required. Copy `.env.example` to `.env`, then run `npm ci`, `npm run server` and, in another terminal, `npm run dev`. Use `http://127.0.0.1:4300` in the Windows host for local testing. Run `npm test`, `npm run build` and `npm run release:check` before contributing.

Windows builds additionally require Visual Studio C++ tools and a Windows SDK. `npm run prepare:flutter` prepares pinned Flutter/WebRTC dependencies. See [development](docs/development.md) for installer setup and build instructions.

Electron and nut.js are compatibility-test dependencies only. They are not shipped in the Flutter installer. Native capture/input is WebDesk code; generated upstream blocks have reproducible manifests.

## Verification and limitations

0.5.3 passed 33 Node tests, 16 Flutter tests, a Windows release build and a public UDP TURN protocol smoke test. Lock-screen password input has been tested on Windows. Sleep/resume, GPU/driver combinations, UAC and keyboard layouts still require validation on your devices. Protocol tests do not establish performance parity with the official proprietary BilldDesk client.

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

MIT for WebDesk code; dependency licenses remain applicable. See [LICENSE](LICENSE.txt) and [third-party notices](THIRD_PARTY_NOTICES.md).
