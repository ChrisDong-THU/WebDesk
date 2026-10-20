#pragma once
#include "loopback_capturer.h"
#include <stdexcept>

namespace flutter_webrtc_plugin {
// Own audio independently of desktop video capturers. Reuse the pinned plugin's
// WASAPI loopback implementation; never select or fall back to a microphone.
class WebDeskSystemAudio {
 public:
  explicit WebDeskSystemAudio(scoped_refptr<RTCAudioSource> source) : source_(source) {}
  ~WebDeskSystemAudio() { SetEnabled(false); }
  void SetEnabled(bool enabled) {
    if (!enabled) {
      if (capturer_) capturer_->Stop();
      capturer_.reset();
      return;
    }
    if (capturer_) return;
    auto capture = CreateLoopbackCapturer("0");
    if (!capture || !capture->Start(source_)) {
      throw std::runtime_error("Windows system audio capture is unavailable");
    }
    capturer_ = std::move(capture);
  }
 private:
  scoped_refptr<RTCAudioSource> source_;
  std::unique_ptr<LoopbackCapturer> capturer_;
};
}  // namespace flutter_webrtc_plugin
