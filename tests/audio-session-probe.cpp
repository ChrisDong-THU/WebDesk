// Read-only WASAPI probe: virtual render-loopback capture must never open an
// active session on a microphone/capture endpoint.
#include <windows.h>
#include <audiopolicy.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>
#include <iostream>
#include <stdexcept>
#include <string>

using Microsoft::WRL::ComPtr;

static void Check(HRESULT result) {
  if (FAILED(result)) throw std::runtime_error("WASAPI inspection failed");
}

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  const DWORD target = static_cast<DWORD>(std::stoul(argv[1]));
  const HRESULT initialized = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(initialized)) return 3;
  int exit_code = 0;
  try {
    ComPtr<IMMDeviceEnumerator> enumerator;
    Check(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                           IID_PPV_ARGS(&enumerator)));
    ComPtr<IMMDeviceCollection> devices;
    Check(enumerator->EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, &devices));
    UINT endpoints = 0;
    Check(devices->GetCount(&endpoints));
    unsigned active = 0, open = 0;
    for (UINT index = 0; index < endpoints; ++index) {
      ComPtr<IMMDevice> device;
      Check(devices->Item(index, &device));
      ComPtr<IAudioSessionManager2> manager;
      Check(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL,
                             nullptr, reinterpret_cast<void**>(manager.GetAddressOf())));
      ComPtr<IAudioSessionEnumerator> sessions;
      Check(manager->GetSessionEnumerator(&sessions));
      int count = 0;
      Check(sessions->GetCount(&count));
      for (int session_index = 0; session_index < count; ++session_index) {
        ComPtr<IAudioSessionControl> session;
        ComPtr<IAudioSessionControl2> details;
        Check(sessions->GetSession(session_index, &session));
        Check(session.As(&details));
        DWORD process = 0;
        Check(details->GetProcessId(&process));
        AudioSessionState state;
        Check(session->GetState(&state));
        if (process == target) {
          if (state != AudioSessionStateExpired) ++open;
          if (state == AudioSessionStateActive) ++active;
        }
      }
    }
    std::cout << "{\"captureEndpoints\":" << endpoints
              << ",\"openCaptureSessions\":" << open
              << ",\"activeCaptureSessions\":" << active << "}\n";
  } catch (const std::exception& error) {
    std::cerr << error.what() << "\n";
    exit_code = 1;
  }
  CoUninitialize();
  return exit_code;
}
