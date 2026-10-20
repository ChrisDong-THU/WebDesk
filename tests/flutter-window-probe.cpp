#include <windows.h>
#include <iostream>
#include <string>

namespace {
DWORD target_pid;
HWND target;
BOOL CALLBACK Find(HWND hwnd, LPARAM) {
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  wchar_t klass[128]{};
  GetClassNameW(hwnd, klass, 128);
  if (pid == target_pid && std::wstring(klass) == L"FLUTTER_RUNNER_WIN32_WINDOW") {
    target = hwnd;
    return FALSE;
  }
  return TRUE;
}
}

// Test-only probe. Input itself must travel through the browser data channel.
int main(int argc, char** argv) {
  if (argc != 3) return 1;
  target_pid = static_cast<DWORD>(std::stoul(argv[1]));
  SetProcessDPIAware();
  EnumWindows(Find, 0);
  if (!target) return 2;
  const std::string action = argv[2];
  if (action == "lock") {
    if (!LockWorkStation()) return 6;
    std::cout << "{\"locking\":true}\n";
    return 0;
  }
  if (action == "show") {
    ShowWindow(target, SW_RESTORE);
    SetWindowPos(target, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
    SetForegroundWindow(target);
  } else if (action != "inspect") {
    return 3;
  }
  DWORD_PTR reply = 0;
  if (!SendMessageTimeout(target, WM_NULL, 0, 0, SMTO_ABORTIFHUNG, 2000, &reply)) {
    return 4;
  }
  TITLEBARINFOEX info{};
  info.cbSize = sizeof(info);
  if (!SendMessageTimeout(target, WM_GETTITLEBARINFOEX, 0,
                          reinterpret_cast<LPARAM>(&info),
                          SMTO_ABORTIFHUNG, 2000, &reply)) return 5;
  POINT cursor{};
  GetCursorPos(&cursor);
  std::cout << "{\"cursorX\":" << cursor.x << ",\"cursorY\":" << cursor.y
            << ",\"foreground\":" << (GetForegroundWindow() == target ? "true" : "false")
            << ",\"visible\":" << (IsWindowVisible(target) ? "true" : "false")
            << ",\"minimized\":" << (IsIconic(target) ? "true" : "false")
            << ",\"maximized\":" << (IsZoomed(target) ? "true" : "false")
            << ",\"buttons\":[";
  for (int i : {2, 3, 5}) {
    const RECT rect = info.rgrect[i];
    if (i != 2) std::cout << ",";
    std::cout << "{\"x\":" << (rect.left + rect.right) / 2
              << ",\"y\":" << (rect.top + rect.bottom) / 2 << "}";
  }
  std::cout << "]}\n";
}
