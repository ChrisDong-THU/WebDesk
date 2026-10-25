#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include "src/rtc_desktop_capturer_impl.h"
#include "rtc_video_frame.h"
#include "src/rtc_video_frame_impl.h"
#include "src/rtc_desktop_media_list_impl.h"
#ifdef WEBRTC_WIN
#include "src/internal/desktop_d3d11_capturer.h"
#endif
#include "modules/desktop_capture/desktop_capture_types.h"

namespace {
int failures = 0;
void Check(bool ok, const char* name) {
  std::printf("%s=%s\n", name, ok ? "PASS" : "FAIL");
  if (!ok) ++failures;
}
class Capture : public libwebrtc::RTCDesktopCapturerImpl {
 public:
  Capture() : RTCDesktopCapturerImpl(libwebrtc::kScreen, -1, nullptr, nullptr, false) {}
  using RTCDesktopCapturerImpl::OnCaptureResult;
};
class Sink final : public webrtc::VideoSinkInterface<webrtc::VideoFrame> {
 public:
  void OnFrame(const webrtc::VideoFrame& frame) override { frames.push_back(frame); }
  std::vector<webrtc::VideoFrame> frames;
};
class Frame final : public webrtc::DesktopFrame {
 public:
  Frame(int w, int h, int pad)
      : DesktopFrame(webrtc::DesktopSize(w, h), w * 4 + pad,
                     new uint8_t[(w * 4 + pad) * h], nullptr) {}
  ~Frame() override { delete[] data(); }
};

#ifdef WEBRTC_WIN
class LiveSink final : public webrtc::VideoSinkInterface<webrtc::VideoFrame> {
 public:
  void OnFrame(const webrtc::VideoFrame& frame) override {
    std::lock_guard<std::mutex> lock(mutex_);
    ++frames_;
    last_ = frame.video_frame_buffer();
    if (last_->type() == webrtc::VideoFrameBuffer::Type::kNative) {
      ++native_frames_;
      if (!retained_) retained_ = last_;
    } else ++cpu_frames_;
    cv_.notify_all();
  }
  bool Wait(bool native, int minimum) {
    std::unique_lock<std::mutex> lock(mutex_);
    return cv_.wait_for(lock, std::chrono::seconds(4), [&] {
      return (native ? native_frames_ : cpu_frames_) >= minimum;
    });
  }
  webrtc::scoped_refptr<webrtc::VideoFrameBuffer> Retained() {
    std::lock_guard<std::mutex> lock(mutex_); return retained_;
  }
 private:
  std::mutex mutex_;
  std::condition_variable cv_;
  int frames_ = 0, native_frames_ = 0, cpu_frames_ = 0;
  webrtc::scoped_refptr<webrtc::VideoFrameBuffer> last_, retained_;
};

void TestLiveRepresentationSwitch() {
  auto capture = libwebrtc::scoped_refptr<Capture>(new libwebrtc::RefCountedObject<Capture>());
  libwebrtc::RTCDesktopCapturer::CapturePolicy policy;
  policy.max_width = 160; policy.max_height = 90;
  Check(!capture->SetNativeTextureEnabled(false), "stopped_native_switch_rejected");
  capture->SetCapturePolicy(policy);
  LiveSink sink;
  webrtc::VideoSinkWants wants; wants.max_framerate_fps = 30;
  capture->AddOrUpdateSink(&sink, wants);
  capture->Start(30);
  if (!capture->GetCaptureHealth().native_texture_active) {
    std::printf("live_representation_switch=SKIP_NATIVE_UNAVAILABLE\n");
    capture->Stop(); capture->RemoveSink(&sink); return;
  }
  Check(sink.Wait(true, 2), "live_native_source_delivers_before_switch");
  auto held = sink.Retained();
  auto held_pixels = held ? held->ToI420() : nullptr;
  uint64_t checksum_before = 0;
  if (held_pixels) for (int y = 0; y < held_pixels->height(); ++y)
    for (int x = 0; x < held_pixels->width(); ++x)
      checksum_before += held_pixels->DataY()[y * held_pixels->StrideY() + x];
  const auto before = capture->GetCaptureHealth();
  Check(capture->SetNativeTextureEnabled(false), "live_native_to_cpu_same_source_switch");
  const auto switched = capture->GetCaptureHealth();
  Check(!switched.native_texture_active && switched.native_texture_unavailable_reason == 1 &&
        switched.rebuilds == before.rebuilds + 1 && switched.native_texture_errors == 0,
        "live_cpu_switch_observable_policy_reason");
  Check(capture->SetNativeTextureEnabled(false) &&
        capture->GetCaptureHealth().rebuilds == switched.rebuilds,
        "live_repeated_disable_does_not_rebuild");
  Check(sink.Wait(false, 8), "live_same_source_cpu_continues_without_dirty_updates");
  const auto cpu = capture->GetCaptureHealth();
  Check(cpu.frames_delivered > before.frames_delivered && cpu.last_frame_age_ms < 1000 &&
        cpu.output_width <= 160 && cpu.output_height <= 90 && cpu.capture_errors == 0 &&
        cpu.active_backend == libwebrtc::RTCDesktopCapturer::Backend::kDxgi,
        "live_cpu_preserves_dimensions_health_and_dxgi_without_overlap");
  Check(capture->SetNativeTextureEnabled(true) &&
        capture->GetCaptureHealth().native_texture_active && sink.Wait(true, 4),
        "live_cpu_to_native_releases_controller_duplication");
  uint64_t checksum_after = 0;
  auto retained = held ? held->ToI420() : nullptr;
  if (retained) for (int y = 0; y < retained->height(); ++y)
    for (int x = 0; x < retained->width(); ++x)
      checksum_after += retained->DataY()[y * retained->StrideY() + x];
  Check(retained && checksum_before == checksum_after && retained->width() <= 160 &&
        retained->height() <= 90, "live_retained_native_frame_survives_both_rebuilds");
  capture->Stop();
  Check(!capture->SetNativeTextureEnabled(false) && !capture->IsRunning(),
        "live_switch_after_stop_does_not_restart");
  capture->RemoveSink(&sink);
}

void TestGpuConverter() {
  using Microsoft::WRL::ComPtr;
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11DeviceContext> context;
  D3D_FEATURE_LEVEL level{};
  const HRESULT created = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
      D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
      nullptr, 0, D3D11_SDK_VERSION, &device, &level, &context);
  libwebrtc::desktop_d3d11::Converter converter;
  if (FAILED(created) || !converter.Initialize(device, context, 64, 64, 32, 32)) {
    std::printf("gpu_video_processor=SKIP_UNSUPPORTED (device HRESULT=0x%08lx)\n", created);
    return;
  }
  D3D11_TEXTURE2D_DESC desc{};
  desc.Width = 64; desc.Height = 64; desc.MipLevels = 1; desc.ArraySize = 1;
  desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM; desc.SampleDesc.Count = 1;
  desc.BindFlags = D3D11_BIND_RENDER_TARGET; desc.Usage = D3D11_USAGE_DEFAULT;
  ComPtr<ID3D11Texture2D> input;
  Check(SUCCEEDED(device->CreateTexture2D(&desc, nullptr, &input)), "gpu_input_texture");
  if (!input) return;
  std::vector<uint8_t> pixels(64 * 64 * 4);
  auto convert = [&](uint8_t red, uint8_t green, uint8_t blue) {
    for (size_t i = 0; i < pixels.size(); i += 4) {
      pixels[i] = blue; pixels[i + 1] = green; pixels[i + 2] = red; pixels[i + 3] = 255;
    }
    context->UpdateSubresource(input.Get(), 0, nullptr, pixels.data(), 64 * 4, 0);
    return converter.Convert(input.Get());
  };
  auto red = convert(255, 0, 0);
  Check(red && red->type() == webrtc::VideoFrameBuffer::Type::kNative &&
        red->storage_representation() == "WebDesk.D3D11.NV12" &&
        red->width() == 32 && red->height() == 32, "gpu_nv12_native_surface_and_scale");
  if (!red) return;
  auto readable = red->ToI420();
  const bool red_ok = readable && readable->DataY()[0] >= 79 && readable->DataY()[0] <= 84 &&
      readable->DataU()[0] >= 87 && readable->DataU()[0] <= 93 &&
      readable->DataV()[0] >= 237 && readable->DataV()[0] <= 243;
  if (readable) std::printf("gpu_red_yuv=%u,%u,%u\n", readable->DataY()[0], readable->DataU()[0], readable->DataV()[0]);
  Check(red_ok, "gpu_bt601_limited_red_readback");
  auto blue = convert(0, 0, 255), black = convert(0, 0, 0), white = convert(255, 255, 255);
  auto fifth = convert(0, 255, 0);
  Check(blue && black && white && !fifth && converter.overloaded(), "gpu_four_slot_overload");
  auto dark = black ? black->ToI420() : nullptr;
  auto light = white ? white->ToI420() : nullptr;
  Check(dark && light && dark->DataY()[0] >= 14 && dark->DataY()[0] <= 18 &&
        light->DataY()[0] >= 233 && light->DataY()[0] <= 237, "gpu_black_white_limited_range");
  Check(readable && red->ToI420()->DataY()[0] == readable->DataY()[0] &&
        red->ToI420()->DataV()[0] == readable->DataV()[0], "gpu_retained_surface_immutable");
  auto wrapper = libwebrtc::scoped_refptr<libwebrtc::RTCVideoFrame>(
      new libwebrtc::RefCountedObject<libwebrtc::VideoFrameBufferImpl>(
          webrtc::scoped_refptr<webrtc::VideoFrameBuffer>(red)));
  std::vector<uint8_t> argb(32 * 32 * 4);
  Check(wrapper->ConvertToARGB(libwebrtc::RTCVideoFrame::Type::kARGB,
        argb.data(), 32 * 4, 32, 32) == 32 * 32 * 4 && wrapper->DataY(),
        "gpu_native_renderer_lazy_readback");
  blue = nullptr; black = nullptr; white = nullptr;
  auto green = convert(0, 255, 0);
  Check(green != nullptr, "gpu_pool_recovers");
  auto green_pixels = green ? green->ToI420() : nullptr;
  ID3D11Texture2D* reused_surface = green ? green->texture() : nullptr;
  const bool green_ok = green_pixels && green_pixels->DataY()[0] >= 142 &&
      green_pixels->DataY()[0] <= 147 && green_pixels->DataU()[0] >= 51 &&
      green_pixels->DataU()[0] <= 57 && green_pixels->DataV()[0] >= 31 &&
      green_pixels->DataV()[0] <= 37;
  green_pixels = nullptr; green = nullptr;
  auto reused_blue = convert(0, 0, 255);
  auto blue_pixels = reused_blue ? reused_blue->ToI420() : nullptr;
  Check(green_ok && reused_blue && reused_blue->texture() == reused_surface &&
        blue_pixels && blue_pixels->DataY()[0] >= 38 && blue_pixels->DataY()[0] <= 44 &&
        blue_pixels->DataU()[0] >= 237 && blue_pixels->DataU()[0] <= 243 &&
        blue_pixels->DataV()[0] >= 107 && blue_pixels->DataV()[0] <= 113,
        "gpu_staging_reuse_reads_new_pixels_after_reset");

  auto shared_pool = std::make_shared<libwebrtc::desktop_d3d11::TexturePool>();
  libwebrtc::desktop_d3d11::Converter before, after;
  const bool shared_ready = before.Initialize(device, context, 64, 64, 32, 32, shared_pool) &&
      after.Initialize(device, context, 64, 64, 16, 16, shared_pool);
  std::vector<webrtc::scoped_refptr<libwebrtc::desktop_d3d11::Buffer>> old_frames;
  if (shared_ready) for (int i = 0; i < 4; ++i) old_frames.push_back(before.Convert(input.Get()));
  auto overflow_resize = shared_ready ? after.Convert(input.Get()) : nullptr;
  Check(shared_ready && old_frames.size() == 4 && old_frames[0] &&
        !overflow_resize && after.overloaded(), "gpu_pool_bound_survives_rebuild_resize");
  old_frames.clear();
  auto resized = shared_ready ? after.Convert(input.Get()) : nullptr;
  Check(resized && resized->width() == 16 && resized->height() == 16,
        "gpu_resize_recovers_after_release");

  // Capability-only probe: creates the duplicator but never requests pixels.
  // Full desktop may use one physical monitor even when adapter enumeration
  // has a different number of active DISPLAY_DEVICE records.
  HMONITOR single_monitor = nullptr;
  uint32_t monitor_reason = 0;
  const bool mapped = libwebrtc::desktop_d3d11::ResolveSingleDesktopMonitor(
      &single_monitor, &monitor_reason);
  Check((mapped && single_monitor && monitor_reason == 0) ||
        (!mapped && monitor_reason >= 6 && monitor_reason <= 8),
        "full_desktop_monitor_mapping_diagnostic");
  uint32_t unavailable = 0;
  int64_t capture_hresult = 0;
  auto full_desktop = libwebrtc::desktop_d3d11::Capturer::Create(
      -1, 0, 720, std::make_shared<libwebrtc::desktop_d3d11::TexturePool>(),
      &unavailable, &capture_hresult);
  std::printf("full_desktop_native_capability=%s reason=%u hresult=0x%08llx\n",
      full_desktop ? "SUPPORTED" : "UNAVAILABLE", unavailable,
      static_cast<unsigned long long>(capture_hresult) & 0xffffffffULL);
  Check((full_desktop && unavailable == 0 && capture_hresult == 0) ||
        (!full_desktop && unavailable >= 6 && unavailable <= 19),
        "full_desktop_create_failure_explained");
  if (full_desktop) {
    full_desktop.reset();
    // Construction previously initialized the process-global DXGI controller
    // even before any source/thumbnail capture, monopolizing the output.
    auto list = libwebrtc::scoped_refptr<libwebrtc::RTCDesktopMediaListImpl>(
        new libwebrtc::RefCountedObject<libwebrtc::RTCDesktopMediaListImpl>(
            libwebrtc::kScreen, nullptr));
    auto after_list = libwebrtc::desktop_d3d11::Capturer::Create(
        -1, 0, 720, std::make_shared<libwebrtc::desktop_d3d11::TexturePool>(),
        &unavailable, &capture_hresult);
    std::printf("native_after_media_list=%s reason=%u hresult=0x%08llx\n",
        after_list ? "SUPPORTED" : "UNAVAILABLE", unavailable,
        static_cast<unsigned long long>(capture_hresult) & 0xffffffffULL);
    Check(after_list != nullptr, "media_list_does_not_reserve_dxgi_output");
    after_list.reset();
    // Dropping a CPU DXGI capturer must also release its controller reservation
    // so a later session/probe can return to the native path.
    auto options = webrtc::DesktopCaptureOptions::CreateDefault();
    options.set_allow_directx_capturer(true);
    auto cpu = webrtc::DesktopCapturer::CreateScreenCapturer(options);
    Check(cpu != nullptr, "cpu_dxgi_fallback_can_be_constructed");
    cpu.reset();
    auto after_cpu = libwebrtc::desktop_d3d11::Capturer::Create(
        -1, 0, 720, std::make_shared<libwebrtc::desktop_d3d11::TexturePool>(),
        &unavailable, &capture_hresult);
    Check(after_cpu != nullptr, "native_recovers_after_cpu_dxgi_release");
  } else {
    std::printf("media_list_dxgi_ownership=SKIP_NATIVE_UNAVAILABLE\n");
  }
}
#endif
}

int main() {
  using libwebrtc::capture_policy::Recovery;
  using libwebrtc::capture_policy::Fit;
  using libwebrtc::capture_policy::FrameRateGate;
  FrameRateGate gate;
  int sixty_count = 0;
  for (int i = 0; i <= 625; ++i)
    if (gate.ShouldDeliver(int64_t{i} * 16000, 60)) ++sixty_count;
  Check(sixty_count >= 599 && sixty_count <= 601, "fps60_at_16ms_keeps_fractional_credit");
  gate.Reset();
  int thirty_count = 0;
  for (int i = 0; i <= 303; ++i)
    if (gate.ShouldDeliver(int64_t{i} * 33000, 30)) ++thirty_count;
  Check(thirty_count >= 299 && thirty_count <= 301, "fps30_at_33ms_keeps_fractional_credit");
  gate.Reset();
  Check(gate.ShouldDeliver(0, 60) && gate.ShouldDeliver(5000000, 60) &&
        !gate.ShouldDeliver(5000001, 60) && gate.ShouldDeliver(5016667, 60),
        "fps_long_pause_cannot_accumulate_burst");
  Check(gate.ShouldDeliver(5017000, 30) && !gate.ShouldDeliver(5017001, 30),
        "fps_change_resets_deadline");
  Check(gate.ShouldDeliver(5017001, 2147483647) &&
        gate.ShouldDeliver(5017001, 2147483647), "unlimited_sink_does_not_throttle_equal_timestamps");
  Recovery r; r.Reset(0);
  for (int i = 0; i < 7; ++i) r.Failure(100, false);
  Check(!r.recovering(), "transient_threshold");
  r.Failure(100, false);
  Check(r.recovering() && !r.Due(1099) && r.Due(1100) && r.NextBackend() == 3,
        "error_rebuild_cooldown");
  r.Rebuilt(1100, true, 3); r.Frame(1101, 3); r.Frame(2000, 3);
  Check(!r.Due(31099) && r.Due(31100) && r.NextBackend() == 0,
        "gdi_hardware_probe_after_cooldown");
  r.Rebuilt(31100, true, 0); r.Frame(31101, 1);
  Check(!r.recovering() && !r.Due(1000000), "hardware_recovery_stops_probes");
  r.Failure(40000, true);
  Check(r.Due(41000) && r.NextBackend() == 3, "permanent_failure_falls_back");
  int64_t now = 41000;
  bool bounded_retry = true;
  for (int i = 0; i < 20; ++i) {
    r.Rebuilt(now, false, 3);
    bounded_retry &= !r.Due(now) && r.Due(now + 30000);
    now += 30000;
  }
  Check(bounded_retry, "failed_rebuild_bounded_backoff");
  r.Reset(3); r.Frame(0, 3);
  Check(!r.recovering() && !r.Due(100000), "explicit_gdi_never_probes_hardware");
  int w = 0, h = 0;
  Check(Fit(3840, 2160, 0, 720, &w, &h) && w == 1280 && h == 720,
        "fit_4k_to_720p");
  Check(Fit(1080, 1920, 640, 720, &w, &h) && w == 404 && h == 720,
        "portrait_preserves_aspect");
  Check(!Fit(32768, 32768, 0, 0, &w, &h) &&
        !Fit(0, 10, 0, 0, &w, &h), "oversize_and_empty_rejected");

  auto capture = libwebrtc::scoped_refptr<Capture>(new libwebrtc::RefCountedObject<Capture>());
  libwebrtc::RTCDesktopCapturer::CapturePolicy policy;
  policy.max_height = 720;
  Check(capture->SetCapturePolicy(policy), "configure_early_scale");
  Sink sink; capture->AddOrUpdateSink(&sink, webrtc::VideoSinkWants());
  auto publish = [&](int width, int height, uint8_t blue) {
    auto frame = std::make_unique<Frame>(width, height, 16);
    std::memset(frame->data(), 0x7f, static_cast<size_t>(frame->stride()) * height);
    for (int y = 0; y < height; ++y) for (int x = 0; x < width; ++x) {
      auto p = frame->data() + y * frame->stride() + x * 4;
      p[0] = blue; p[1] = 0; p[2] = 255 - blue; p[3] = 255;
    }
    frame->set_capturer_id(webrtc::DesktopCapturerId::kScreenCapturerWinGdi);
    capture->OnCaptureResult(webrtc::DesktopCapturer::Result::SUCCESS, std::move(frame));
  };
  publish(3840, 2160, 0);
  Check(sink.frames.size() == 1 && sink.frames[0].width() == 1280 &&
        sink.frames[0].height() == 720, "production_early_downsample");
  const auto old = sink.frames[0].video_frame_buffer()->ToI420();
  const int y0 = old->DataY()[0], u0 = old->DataU()[0], v0 = old->DataV()[0];
  Check(y0 >= 80 && y0 <= 83 && u0 >= 89 && u0 <= 92 && v0 >= 238 && v0 <= 241,
        "bgra_red_bt601_limited_color");
  publish(16, 8, 255); publish(18, 8, 0); publish(20, 8, 255);
  const size_t full = sink.frames.size(); publish(22, 8, 0);
  Check(full == 4 && sink.frames.size() == 4 && old->DataY()[0] == y0 &&
        old->DataU()[0] == u0 && old->DataV()[0] == v0,
        "four_slots_bounded_across_resolution_changes");
  auto health = capture->GetCaptureHealth();
  Check(health.active_backend == libwebrtc::RTCDesktopCapturer::Backend::kGdi &&
        health.frames_captured == 5 && health.frames_delivered == 4 &&
        health.frames_dropped == 1 && health.recovering && health.convert_time_us >= 0 &&
        health.last_frame_age_ms >= 0, "health_from_actual_frames_and_overload");
  sink.frames.clear(); publish(22, 8, 255);
  Check(sink.frames.size() == 1, "pool_recovers_after_consumers_release");
  capture->RemoveSink(&sink);

  auto throttled = libwebrtc::scoped_refptr<Capture>(new libwebrtc::RefCountedObject<Capture>());
  Sink slow_sink;
  webrtc::VideoSinkWants slow_wants;
  slow_wants.max_framerate_fps = 1;
  slow_wants.max_pixel_count = 320 * 180;
  throttled->AddOrUpdateSink(&slow_sink, slow_wants);
  for (int i = 0; i < 2; ++i) {
    auto frame = std::make_unique<Frame>(1920, 1080, 0);
    std::memset(frame->data(), 0xff, static_cast<size_t>(frame->stride()) * 1080);
    throttled->OnCaptureResult(webrtc::DesktopCapturer::Result::SUCCESS, std::move(frame));
  }
  auto throttled_health = throttled->GetCaptureHealth();
  Check(slow_sink.frames.size() == 1 && slow_sink.frames[0].width() *
        slow_sink.frames[0].height() <= 320 * 180 && throttled_health.frames_captured == 2 &&
        throttled_health.frames_delivered == 1 && throttled_health.frames_dropped == 1,
        "sink_fps_pixel_budget_before_bgra_conversion");
  throttled->RemoveSink(&slow_sink);

  std::vector<uint8_t> pixels(4 * 4 * 4 + 4 * 16, 0);
  std::vector<libwebrtc::scoped_refptr<libwebrtc::RTCVideoFrame>> held;
  for (int i = 0; i < 4; ++i) {
    const int width = i + 2 + (i & 1);
    std::vector<uint8_t> data(static_cast<size_t>(width * 4 + 16) * 4, 0xff);
    held.push_back(libwebrtc::RTCVideoFrame::CreateFromBgra(
        width, 4, data.data(), width * 4 + 16, static_cast<int>(data.size())));
  }
  bool valid = true; for (const auto& frame : held) valid &= frame.get() != nullptr;
  auto overloaded = libwebrtc::RTCVideoFrame::CreateFromBgra(4, 4, pixels.data(), 32, 128);
  Check(valid && !overloaded.get(), "secure_bridge_bounded_pool");
  held.clear();
  auto black = libwebrtc::RTCVideoFrame::CreateFromBgra(4, 4, pixels.data(), 32, 128);
  Check(black.get() && black->DataY()[0] == 16 && black->DataU()[0] == 128 &&
        black->DataV()[0] == 128, "secure_simd_bt601_black_and_padding");
  Check(!libwebrtc::RTCVideoFrame::CreateFromBgra(4, 4, pixels.data(), 32, 111).get() &&
        !libwebrtc::RTCVideoFrame::CreateFromBgra(3, 4, pixels.data(), 32, 128).get() &&
        !libwebrtc::RTCVideoFrame::CreateFromBgra(4, 4, nullptr, 32, 128).get(),
        "secure_invalid_geometry_rejected");
#ifdef WEBRTC_WIN
  TestGpuConverter();
  TestLiveRepresentationSwitch();
#endif
  return failures ? 1 : 0;
}
