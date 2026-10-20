#include <windows.h>

#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "task_runner_windows.h"

int main(int argc, char** argv) {
  if (argc != 2) return 2;
  flutter_webrtc_plugin::TaskRunnerWindows runner;
  HWND window = FindWindowExW(HWND_MESSAGE, nullptr,
                             L"FlutterWebRTCWindowsTaskRunnerWindow", nullptr);
  if (!window) return 3;
  const std::string scenario = argv[1];
  std::vector<int> actual;
  if (scenario == "enqueue") {
    runner.EnqueueTask([&] {
      actual.push_back(1);
      runner.EnqueueTask([&] { actual.push_back(3); });
    });
    runner.EnqueueTask([&] { actual.push_back(2); });
  } else if (scenario == "reentrant") {
    runner.EnqueueTask([&] {
      actual.push_back(1);
      // A native/Flutter callback can enter a nested Windows message loop.
      SendMessageW(window, WM_NULL, 0, 0);
      actual.push_back(3);
    });
    runner.EnqueueTask([&] { actual.push_back(2); });
  } else if (scenario == "producer") {
    runner.EnqueueTask([&] {
      actual.push_back(1);
      std::thread producer([&] {
        runner.EnqueueTask([&] { actual.push_back(3); });
      });
      producer.join();
    });
    runner.EnqueueTask([&] { actual.push_back(2); });
  } else if (scenario == "destructor") {
    auto capture = std::shared_ptr<int>(new int(0), [&](int* value) {
      delete value;
      runner.EnqueueTask([&] { actual.push_back(3); });
    });
    runner.EnqueueTask([&, capture] { actual.push_back(1); });
    capture.reset();
    runner.EnqueueTask([&] { actual.push_back(2); });
  } else if (scenario == "fairness") {
    int completed = 0;
    TaskClosure next;
    next = [&] {
      if (++completed < 1000) runner.EnqueueTask(next);
    };
    runner.EnqueueTask(next);
    SendMessageW(window, WM_NULL, 0, 0);
    if (completed != 1) return 5;
    const ULONGLONG deadline = GetTickCount64() + 3000;
    while (completed < 1000 && GetTickCount64() < deadline) {
      MSG message;
      if (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
      } else {
        Sleep(1);
      }
    }
    if (completed != 1000) return 6;
    std::cout << scenario << ": passed\n";
    return 0;
  } else {
    return 2;
  }
  const ULONGLONG deadline = GetTickCount64() + 3000;
  while (actual.size() < 3 && GetTickCount64() < deadline) {
    MSG message;
    if (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    } else {
      Sleep(1);
    }
  }
  if (actual != std::vector<int>{1, 2, 3}) return 4;
  std::cout << scenario << ": passed\n";
}
