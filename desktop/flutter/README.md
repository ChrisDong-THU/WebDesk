# WebDesk Windows

Flutter Windows host with native WebRTC.

- [Development and installer build](../../docs/development.md)
- [Architecture and upstream boundaries](../../docs/architecture.md)
- [Security policy](../../SECURITY.md)

The production entrypoint is `lib/main.dart`. `test_driver/` entrypoints are for explicit local integration tests and must never be packaged. SDK and plugin revisions are pinned in `native/flutter/dependencies.json` at the repository root.
