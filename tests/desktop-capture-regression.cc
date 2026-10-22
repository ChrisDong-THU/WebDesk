#include <cstdio>
#include <cstring>
#include <memory>
#include <vector>
#include "src/rtc_desktop_capturer_impl.h"
#include "api/make_ref_counted.h"

// Exercise the production conversion callback with deterministic desktop frames.
// Retaining an earlier VideoFrame models the asynchronous encoder queue.
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
class PaddedFrame final : public webrtc::DesktopFrame {
 public:
  PaddedFrame(int w, int h, int stride)
      : DesktopFrame(webrtc::DesktopSize(w,h), stride, new uint8_t[stride*h], nullptr) {}
  ~PaddedFrame() override { delete[] data(); }
};
int main() {
  auto capture = libwebrtc::scoped_refptr<Capture>(new libwebrtc::RefCountedObject<Capture>());
  Sink sink;
  capture->AddOrUpdateSink(&sink, webrtc::VideoSinkWants());
  auto publish = [&](int w, int h, int padding, uint8_t r, uint8_t g, uint8_t b) {
    auto frame = std::make_unique<PaddedFrame>(w,h,w*4+padding);
    memset(frame->data(), 0x5a, frame->stride()*h);
    for (int y=0; y<h; ++y) for (int x=0; x<w; ++x) {
      auto p=frame->data()+y*frame->stride()+x*4;
      p[0]=b;p[1]=g;p[2]=r;p[3]=255;
    }
    capture->OnCaptureResult(webrtc::DesktopCapturer::Result::SUCCESS,std::move(frame));
  };
  publish(16,8,0,255,0,0);
  auto first=sink.frames.back().video_frame_buffer()->ToI420();
  const int oldY=first->DataY()[0],oldU=first->DataU()[0],oldV=first->DataV()[0];
  publish(16,8,0,0,0,255);
  bool retained=first->DataY()[0]==oldY && first->DataU()[0]==oldU && first->DataV()[0]==oldV;
  publish(16,8,16,255,0,0);
  auto padded=sink.frames.back().video_frame_buffer()->ToI420();
  bool stride=true;
  for(int y=0;y<8;++y) for(int x=0;x<16;++x) stride &= padded->DataY()[y*padded->StrideY()+x]==oldY;
  publish(8,16,0,255,0,0);
  bool dimensions=sink.frames.back().width()==8 && sink.frames.back().height()==16;
  sink.frames.clear();
  for(int i=0;i<4;++i) publish(8,16,0,255,0,0);
  const auto full=sink.frames.size();
  publish(8,16,0,0,255,0);
  bool bounded=full==4 && sink.frames.size()==full;
  sink.frames.clear();
  publish(8,16,0,0,0,255);
  bool recovered=sink.frames.size()==1;
  capture->OnCaptureResult(webrtc::DesktopCapturer::Result::SUCCESS,nullptr);
  bool empty_ignored=sink.frames.size()==1;
  capture->RemoveSink(&sink);
  printf("retained_frame=%s padded_stride=%s equal_area_resize=%s bounded_pool=%s recovery=%s empty_frame=%s\n",retained?"PASS":"FAIL",stride?"PASS":"FAIL",dimensions?"PASS":"FAIL",bounded?"PASS":"FAIL",recovered?"PASS":"FAIL",empty_ignored?"PASS":"FAIL");
  return retained && stride && dimensions && bounded && recovered && empty_ignored ? 0 : 1;
}
