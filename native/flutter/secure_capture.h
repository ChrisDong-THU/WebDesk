#pragma once
#include <windows.h>
#include <atomic>
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
                       int height, int fps) : source_(source), height_(height), fps_(fps) {
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
  static uint8_t Clamp(int value){return static_cast<uint8_t>(value<0?0:value>255?255:value);}
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
      const size_t plane=static_cast<size_t>(w)*h;
      i420_.resize(plane*3/2);auto y=i420_.data(),u=y+plane,v=u+plane/4;
      const auto pixels=bgra_.data()+8;
      for(int row=0;row<h;row+=2) for(int col=0;col<w;col+=2) {
        int red=0,green=0,blue=0;
        for(int dy=0;dy<2;dy++) for(int dx=0;dx<2;dx++) {
          const auto pos=static_cast<size_t>(row+dy)*w+col+dx;const auto p=pixels+pos*4;
          const int b=p[0],g=p[1],r=p[2];red+=r;green+=g;blue+=b;
          y[pos]=Clamp(((66*r+129*g+25*b+128)>>8)+16);
        }
        red/=4;green/=4;blue/=4;const auto uv=static_cast<size_t>(row/2)*(w/2)+col/2;
        u[uv]=Clamp(((-38*red-74*green+112*blue+128)>>8)+128);
        v[uv]=Clamp(((112*red-94*green-18*blue+128)>>8)+128);
      }
      last_frame_=GetTickCount64();
      healthy_=true;
      // Publish health before consumers observe the frame callback.
      source_->OnCapturedFrame(libwebrtc::RTCVideoFrame::Create(w,h,i420_.data(),static_cast<int>(i420_.size())));
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
  std::vector<uint8_t> bgra_,i420_;
};
