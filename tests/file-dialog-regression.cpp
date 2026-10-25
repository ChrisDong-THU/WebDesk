#include <windows.h>

#include <atomic>
#include <iostream>
#include <thread>

#include "file_selection.h"
#include "task_runner_windows.h"
namespace {
FileSelection selection;
LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wparam,
                            LPARAM lparam) {
  if (message == FileSelection::kCompleted) {
    selection.Complete();
    return 0;
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}
HWND FindDialog(HWND owner) {
  struct Search {
    HWND owner, dialog = nullptr;
  } search{owner};
  EnumWindows(
      [](HWND hwnd, LPARAM data) -> BOOL {
        auto* search = reinterpret_cast<Search*>(data);
        DWORD process = 0;
        GetWindowThreadProcessId(hwnd, &process);
        wchar_t name[32]{};
        GetClassNameW(hwnd, name, 32);
        if (process == GetCurrentProcessId() && IsWindowVisible(hwnd) &&
            GetAncestor(hwnd, GA_ROOTOWNER) == search->owner &&
            wcscmp(name, L"#32770") == 0) {
          search->dialog = hwnd;
          return FALSE;
        }
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&search));
  return search.dialog;
}
bool Above(HWND window, HWND other) {
  for (HWND next = GetWindow(window, GW_HWNDNEXT); next;
       next = GetWindow(next, GW_HWNDNEXT)) {
    if (next == other) return true;
  }
  return false;
}
}  // namespace
int main() {
  const DWORD ui_thread = GetCurrentThreadId();
  WNDCLASSW klass{};
  klass.hInstance = GetModuleHandleW(nullptr);
  klass.lpszClassName = L"WebDesk.FileSelectionRegression";
  klass.lpfnWndProc = WindowProc;
  if (!RegisterClassW(&klass)) return 1;
  HWND owner = CreateWindowW(klass.lpszClassName, L"WebDesk picker test",
                             WS_OVERLAPPEDWINDOW, 0, 0, 640, 480, nullptr,
                             nullptr, klass.hInstance, nullptr);
  if (!owner) return 2;
  // A different topmost window must not obscure a newly requested picker.
  HWND blocker = CreateWindowExW(
      WS_EX_TOPMOST | WS_EX_NOACTIVATE, klass.lpszClassName,
      L"WebDesk picker obstruction fixture", WS_POPUP | WS_VISIBLE, 0, 0, 640,
      480, nullptr, nullptr, klass.hInstance, nullptr);
  if (!blocker) return 12;
  flutter_webrtc_plugin::TaskRunnerWindows runner;
  for (const std::string action :
       {"close", "cancel", "minimized-close", "disconnect", "early-cancel"}) {
    const bool minimized = action == "minimized-close";
    ShowWindow(owner, minimized ? SW_SHOWMINNOACTIVE : SW_HIDE);
    SetWindowPos(blocker, HWND_TOPMOST, 0, 0, 0, 0,
                 SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    std::atomic<bool> finished = false, released = false, failed = false;
    std::atomic<bool> topmost = false, above_blocker = false;
    HRESULT result = E_PENDING;
    int replies = 0;
    if (!selection.Open(owner, "session", [&](FileSelection::Outcome outcome) {
          if (GetCurrentThreadId() != ui_thread) failed = true;
          result = outcome.status;
          replies++;
          finished = true;
        }))
      return 3;
    selection.Cancel("previous-session");
    if (selection.Open(owner, "another-session", [](auto) {})) return 4;
    if (action == "early-cancel") selection.Cancel("session");
    std::thread input([&] {
      if (action == "early-cancel") return;
      const auto deadline = GetTickCount64() + 4000;
      HWND dialog = nullptr;
      while (!(dialog = FindDialog(owner)) && GetTickCount64() < deadline)
        Sleep(1);
      if (!dialog) {
        failed = true;
        return;
      }
      if (GetWindowThreadProcessId(dialog, nullptr) == ui_thread) failed = true;
      Sleep(150);
      topmost = (GetWindowLongPtrW(dialog, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0;
      above_blocker = Above(dialog, blocker);
      if (!topmost || !above_blocker ||
          (GetWindowLongPtrW(owner, GWL_EXSTYLE) & WS_EX_TOPMOST) != 0 ||
          (minimized ? !IsIconic(owner) : IsWindowVisible(owner)))
        failed = true;
      if (action == "close" || action == "minimized-close") {
        // Require RTC dispatch to continue while the native picker is open,
        // then deliver the title-bar close command to this process's dialog.
        // No global mouse/keyboard input or other application's window is used.
        runner.EnqueueTask([&, dialog] {
          released = true;
          PostMessageW(dialog, WM_SYSCOMMAND, SC_CLOSE, 0);
        });
      } else if (action == "disconnect") {
        runner.EnqueueTask([&] {
          released = true;
          selection.Cancel("session");
          if (selection.Open(owner, "new-session", [](auto) {})) failed = true;
        });
      } else {
        PostMessageW(dialog, WM_COMMAND, IDCANCEL, 0);
      }
      const auto end = GetTickCount64() + 2000;
      while (!finished && GetTickCount64() < end) Sleep(1);
      if (!finished) {
        failed = true;
        PostMessageW(dialog, WM_CANCELMODE, 0, 0);
        PostMessageW(dialog, WM_COMMAND, IDCANCEL, 0);
      }
    });
    const auto deadline = GetTickCount64() + 7000;
    while (!finished && GetTickCount64() < deadline) {
      MSG message;
      if (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE))
        DispatchMessageW(&message);
      else
        Sleep(1);
    }
    input.join();
    std::cout << action << ": cancelled="
              << (result == HRESULT_FROM_WIN32(ERROR_CANCELLED))
              << " rtcDispatch=" << released << " replies=" << replies
              << " topmost=" << topmost << " aboveBlocker=" << above_blocker
              << " failed=" << failed << std::endl;
    if (failed || replies != 1 ||
        ((action == "close" || action == "minimized-close" ||
          action == "disconnect") &&
         !released) ||
        result != HRESULT_FROM_WIN32(ERROR_CANCELLED))
      return 5;
  }
  int cancellations = 0;
  if (!selection.Open(owner, "shutdown", [&](auto outcome) {
        if (outcome.status == HRESULT_FROM_WIN32(ERROR_CANCELLED))
          cancellations++;
      }))
    return 6;
  const auto ready_deadline = GetTickCount64() + 4000;
  while (!FindDialog(owner) && GetTickCount64() < ready_deadline) {
    MSG message;
    if (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE))
      DispatchMessageW(&message);
    else
      Sleep(1);
  }
  if (!FindDialog(owner)) return 8;
  const auto before_shutdown = GetTickCount64();
  selection.Shutdown();
  selection.Shutdown();
  if (GetTickCount64() - before_shutdown > 100) return 9;
  if (cancellations != 1) return 7;
  if (selection.Open(owner, "after-shutdown", [](auto) {})) return 10;
  const auto closed_deadline = GetTickCount64() + 2000;
  while (FindDialog(owner) && GetTickCount64() < closed_deadline) {
    MSG message;
    if (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE))
      DispatchMessageW(&message);
    else
      Sleep(1);
  }
  if (FindDialog(owner)) return 11;
  DestroyWindow(blocker);
  DestroyWindow(owner);
  std::cout << "shutdown: non-blocking, single cancellation passed"
            << std::endl;
}
