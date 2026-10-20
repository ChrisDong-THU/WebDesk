#include <windows.h>

#include <iostream>
#include <vector>

#include "remote_caption_buttons.h"

namespace {
RemoteCaptionButtons buttons;
std::vector<WPARAM> commands;
int release_hit = HTNOWHERE;

LRESULT CALLBACK WindowProc(HWND hwnd, UINT message, WPARAM wparam,
                            LPARAM lparam) {
  if (auto result = buttons.HandleMessage(hwnd, message, wparam, lparam)) {
    return *result;
  }
  if (message == WM_NCHITTEST) return release_hit;
  if (message == WM_SYSCOMMAND) {
    commands.push_back(wparam);
    return 0;  // Test window only: don't minimize/maximize/close a real app.
  }
  return DefWindowProc(hwnd, message, wparam, lparam);
}

void Drain() {
  MSG message;
  while (PeekMessage(&message, nullptr, 0, 0, PM_REMOVE)) {
    TranslateMessage(&message);
    DispatchMessage(&message);
  }
}

bool Press(HWND hwnd, int hit, LPARAM tag = kWebDeskRemoteMouseTag) {
  SetMessageExtraInfo(tag);
  const auto result = buttons.HandleMessage(hwnd, WM_NCLBUTTONDOWN, hit, 0);
  SetMessageExtraInfo(0);
  return result.has_value() && GetCapture() == hwnd;
}
}  // namespace

int main() {
  WNDCLASSW klass{};
  klass.hInstance = GetModuleHandle(nullptr);
  klass.lpszClassName = L"WebDesk.RemoteCaptionRegression";
  klass.lpfnWndProc = WindowProc;
  if (!RegisterClassW(&klass)) return 1;
  // Hidden, owned window; no SendInput, desktop switching or user interaction.
  HWND hwnd = CreateWindowW(klass.lpszClassName, L"", WS_OVERLAPPEDWINDOW,
                            0, 0, 640, 480, nullptr, nullptr, klass.hInstance, nullptr);
  if (!hwnd) return 2;
  const int hits[] = {HTMINBUTTON, HTMAXBUTTON, HTCLOSE};
  const WPARAM expected[] = {SC_MINIMIZE, SC_MAXIMIZE, SC_CLOSE};
  for (LPARAM tag : {static_cast<LPARAM>(0),
                     static_cast<LPARAM>(kWebDeskRemoteMouseTag)}) {
   for (int i = 0; i < 3; ++i) {
    commands.clear();
    release_hit = hits[i];
    if (!Press(hwnd, hits[i], tag) || !commands.empty()) return 3;
    // Button-up is delivered on a later turn, like a second RTC message.
    PostMessage(hwnd, WM_LBUTTONUP, 0, 0);
    Drain();
    if (commands != std::vector<WPARAM>{expected[i]} || GetCapture() == hwnd) return 4;
   }
  }

  commands.clear();
  const auto style = GetWindowLongPtr(hwnd, GWL_STYLE);
  SetWindowLongPtr(hwnd, GWL_STYLE, style | WS_MAXIMIZE);
  release_hit = HTMAXBUTTON;
  if (!Press(hwnd, HTMAXBUTTON)) return 5;
  SendMessage(hwnd, WM_NCLBUTTONUP, HTMAXBUTTON, 0);
  Drain();
  if (commands != std::vector<WPARAM>{SC_RESTORE}) return 6;
  SetWindowLongPtr(hwnd, GWL_STYLE, style);

  commands.clear();
  if (!Press(hwnd, HTCLOSE)) return 7;
  release_hit = HTCLIENT;  // Drag out and release cancels the click.
  SendMessage(hwnd, WM_LBUTTONUP, 0, 0);
  Drain();
  if (!commands.empty() || GetCapture() == hwnd) return 8;

  for (UINT cancel : {WM_CANCELMODE, WM_CAPTURECHANGED, WM_ACTIVATE}) {
    if (!Press(hwnd, HTCLOSE)) return 9;
    if (cancel == WM_CAPTURECHANGED) ReleaseCapture();
    else SendMessage(hwnd, cancel, WA_INACTIVE, 0);
    release_hit = HTCLOSE;
    SendMessage(hwnd, WM_LBUTTONUP, 0, 0);
    Drain();
    if (!commands.empty() || GetCapture() == hwnd) return 10;
  }

  EnableMenuItem(GetSystemMenu(hwnd, FALSE), SC_CLOSE, MF_BYCOMMAND | MF_GRAYED);
  if (!Press(hwnd, HTCLOSE)) return 11;
  SendMessage(hwnd, WM_LBUTTONUP, 0, 0);
  Drain();
  if (!commands.empty()) return 12;

  SetMessageExtraInfo(static_cast<LPARAM>(kWebDeskRemoteMouseTag));
  for (int hit : {HTCLIENT, HTCAPTION, HTLEFT, HTRIGHT}) {
    if (buttons.HandleMessage(hwnd, WM_NCLBUTTONDOWN, hit, 0)) return 14;
  }
  SetMessageExtraInfo(0);
  DestroyWindow(hwnd);
  UnregisterClassW(klass.lpszClassName, klass.hInstance);
  std::cout << "remote caption: minimize/maximize/restore/close, cancellation, "
               "disabled commands, tagged and legacy untagged input passed\n";
}
