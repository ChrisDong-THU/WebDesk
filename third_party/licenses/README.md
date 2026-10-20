# Native notices

These upstream texts supplement the wrapper, Flutter and Dart notices shipped with the Windows installer.

- `libwebrtc-NOTICE.txt`: exact libwebrtc.m150.7871.05 tag NOTICE (Intel/OWT Apache-2.0 changes).
- `webrtc-LICENSE.txt`, `webrtc-PATENTS.txt`: WebRTC m150 license and patent grant.
- `native/`: Windows-relevant source-license entries from the upstream WebRTC license generator, plus referenced license texts. Includes optional and build-time components; it is not a claim that all of them are linked into the binary.
- `native/sources.json`: exact WebRTC commit, dependency-revision URLs and content hashes used for the collection. Entries from the historical base64 component are omitted because that source path no longer exists at this revision.

Upstream source and dependency repositories are linked in the manifest. Preserve these terms and review changes whenever upgrading libwebrtc or its build flags. The project's MIT license does not replace dependency licenses.
