#include <windows.h>
#include <iostream>
#include "tray_menu.h"

namespace {
HWND outside;
bool timed_out = false;
bool active_owner = false;
bool select_command = false;
LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message == WM_TIMER) {
    if (wparam == 1) {
      KillTimer(hwnd, 1);
      active_owner = GetForegroundWindow() == hwnd;
      if (select_command) {
        PostMessage(hwnd, WM_KEYDOWN, VK_DOWN, 0);
        PostMessage(hwnd, WM_KEYDOWN, VK_RETURN, 0);
      } else {
        // Focus moves to another window, as for an outside click/Alt+Tab.
        SetForegroundWindow(outside);
      }
    } else {
      timed_out = true;
      EndMenu();
    }
    return 0;
  }
  return DefWindowProc(hwnd, message, wparam, lparam);
}
void Drain() {
  MSG message;
  while (PeekMessage(&message, nullptr, 0, 0, PM_REMOVE)) {
    TranslateMessage(&message); DispatchMessage(&message);
  }
}
}

int main(int argc, char**) {
  const bool baseline = argc > 1;
  HWND previous = GetForegroundWindow();
  WNDCLASSW klass{};
  klass.hInstance = GetModuleHandle(nullptr);
  klass.lpszClassName = L"WebDesk.TrayMenuRegression";
  klass.lpfnWndProc = WindowProc;
  if (!RegisterClassW(&klass)) return 1;
  // Test-owned windows only. The application window stays hidden; the outside
  // window is off-screen. No input injection or Explorer window manipulation.
  HWND owner = CreateWindowExW(WS_EX_TOOLWINDOW, klass.lpszClassName, L"",
      WS_POPUP, -10000, -10000, 1, 1, nullptr, nullptr, klass.hInstance, nullptr);
  outside = CreateWindowExW(WS_EX_TOOLWINDOW, klass.lpszClassName, L"",
      WS_POPUP | WS_VISIBLE, -10000, -10000, 1, 1, nullptr, nullptr, klass.hInstance, nullptr);
  HMENU menu = CreatePopupMenu();
  AppendMenuW(menu, MF_STRING, 101, L"WebDesk regression item");
  int failed = 0;
  for (int iteration = 0; iteration < (baseline ? 1 : 4); ++iteration) {
    select_command = iteration == 3;
    timed_out = active_owner = false;
    SetForegroundWindow(outside);
    SetTimer(owner, 1, 80, nullptr);
    SetTimer(owner, 2, 1000, nullptr);
    const UINT command = baseline
        ? static_cast<UINT>(TrackPopupMenu(menu, TPM_RETURNCMD | TPM_NONOTIFY,
              0, 0, 0, owner, nullptr))
        : ShowTrayContextMenu(owner, menu, POINT{0, 0});
    KillTimer(owner, 1); KillTimer(owner, 2);
    Drain();
    std::cout << "iteration=" << iteration << " foreground=" << active_owner
              << " timeout=" << timed_out << " command=" << command
              << " mainVisible=" << IsWindowVisible(owner) << "\n";
    if (baseline ? !timed_out :
        (timed_out || !active_owner || IsWindowVisible(owner) ||
         command != (select_command ? 101u : 0u))) failed = 2;
  }
  DestroyMenu(menu); DestroyWindow(owner); DestroyWindow(outside);
  if (previous) SetForegroundWindow(previous);
  if (!failed) std::cout << (baseline ? "Baseline bug reproduced\n" : "Tray menu regression passed\n");
  return failed;
}
