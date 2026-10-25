#pragma once
#include <windows.h>
#include <atomic>
#include <algorithm>
#include <chrono>
#include <cstring>
#include <thread>
#include <vector>
#include <stdexcept>
#include "rtc_video_source.h"
#include "rtc_video_frame.h"

// A narrow, per-session bridge. Only raw frames cross the native pipe; Dart
// never receives pixels. Relay verifies the SYSTEM server and service verifies
// this application's installed path. It cannot run arbitrary commands.
class WebDeskSecureCapture {
 public:
  WebDeskSecureCapture(libwebrtc::scoped_refptr<libwebrtc::RTCVideoSource> source,
                       int height, int fps) : source_(source), height_(std::clamp(height, 2, 32768)), fps_(std::clamp(fps, 1, 60)) {
    SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
    HANDLE child_in=nullptr, child_out=nullptr;
    if (!CreatePipe(&child_in, &write_, &sa, 0)) throw std::runtime_error("Capture input pipe failed");
    if (!CreatePipe(&read_, &child_out, &sa, 0)) { CloseHandle(child_in);CloseHandle(write_);throw std::runtime_error("Capture output pipe failed"); }
    SetHandleInformation(write_, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(read_, HANDLE_FLAG_INHERIT, 0);
    wchar_t folder[32768];
    const DWORD length=GetEnvironmentVariableW(L"ProgramW6432",folder,32768);
    if (!length || length>=32768) { CloseHandle(child_in);CloseHandle(child_out);CloseHandle(read_);CloseHandle(write_);throw std::runtime_error("Program Files unavailable"); }
    std::wstring exe=std::wstring(folder)+L"\\WebDesk Native\\WebDeskNative.exe";
    std::wstring command=L"\""+exe+L"\" --bridge";
    STARTUPINFOW startup{};startup.cb=sizeof(startup);startup.dwFlags=STARTF_USESTDHANDLES;
    startup.hStdInput=child_in;startup.hStdOutput=child_out;startup.hStdError=child_out;
    PROCESS_INFORMATION process{};
    const BOOL ok=CreateProcessW(exe.c_str(),command.data(),nullptr,nullptr,TRUE,CREATE_NO_WINDOW,nullptr,nullptr,&startup,&process);
    CloseHandle(child_in);CloseHandle(child_out);
    if(!ok) {CloseHandle(read_);CloseHandle(write_);throw std::runtime_error("Capture worker failed to start");}
    process_=process.hProcess;CloseHandle(process.hThread);
    thread_=std::thread([this]{ Run(); });
  }
  ~WebDeskSecureCapture() {
    stopped_=true;
    if(process_) TerminateProcess(process_,0);
    if(thread_.joinable()) { CancelSynchronousIo(thread_.native_handle());thread_.join(); }
    if(read_)CloseHandle(read_);if(write_)CloseHandle(write_);if(process_)CloseHandle(process_);
  }
  bool healthy() const {return healthy_ && GetTickCount64()-last_frame_.load()<10000;}
 private:
  bool Read(void* destination,size_t count) {
    auto p=static_cast<uint8_t*>(destination);
    while(count && !stopped_) {DWORD read=0;if(!ReadFile(read_,p,static_cast<DWORD>(count),&read,nullptr)||!read)return false;p+=read;count-=read;}
    return !count;
  }
  void Run() {
    while(!stopped_) {
      const auto started=std::chrono::steady_clock::now();
      uint8_t request[9]={5,0,0,0,5,0,0,0,0};memcpy(request+5,&height_,4);
      DWORD written=0;
      if(!WriteFile(write_,request,9,&written,nullptr)||written!=9)break;
      uint32_t header[2];if(!Read(header,8)||header[1]>160000008)break;
      bgra_.resize(header[1]);if(!Read(bgra_.data(),bgra_.size()))break;
      // Desktop transitions can briefly reject a capture. Keep the last
      // successful frame healthy within the bounded freshness window.
      if(header[0]!=0) {Sleep(100);continue;}
      if(bgra_.size()<8)break;
      int w,h;memcpy(&w,bgra_.data(),4);memcpy(&h,bgra_.data()+4,4);
      if(w<2||h<2||(w&1)||(h&1)||static_cast<int64_t>(w)*h>40000000||bgra_.size()!=8+static_cast<size_t>(w)*h*4)break;
      // libwebrtc owns a four-slot conversion pool and uses its already-linked
      // libyuv SIMD implementation (BGRA -> BT.601 limited I420). The native
      // bridge wire format is unchanged; caller bytes are never retained.
      auto frame=libwebrtc::RTCVideoFrame::CreateFromBgra(
          w,h,bgra_.data()+8,w*4,static_cast<int>(bgra_.size()-8));
      if(frame.get()) {
        last_frame_=GetTickCount64();
        healthy_=true;
        source_->OnCapturedFrame(frame);
      }
      const auto next=started+std::chrono::milliseconds(1000/fps_);
      std::this_thread::sleep_until(next);
    }
    healthy_=false;
  }
  libwebrtc::scoped_refptr<libwebrtc::RTCVideoSource> source_;
  int height_,fps_;
  HANDLE read_=nullptr,write_=nullptr,process_=nullptr;
  std::thread thread_;
  std::atomic<bool> stopped_{false},healthy_{false};
  std::atomic<ULONGLONG> last_frame_{0};
  std::vector<uint8_t> bgra_;
};
