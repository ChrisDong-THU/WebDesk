#ifndef WEBDESK_REMOTE_CAPTION_BUTTONS_H_
#define WEBDESK_REMOTE_CAPTION_BUTTONS_H_

#include <windows.h>
#include <windowsx.h>
#include <dwmapi.h>

#include <optional>

// Must match Worker.Inject's mouse extra-info marker. This identifies our
// injected input; it is not an authorization or security boundary.
constexpr ULONG_PTR kWebDeskRemoteMouseTag = 0x57444249;

// DefWindowProc tracks caption button presses in a nested native loop. Remote
// button-up delivery depends on Flutter/WebRTC continuing to dispatch work on
// this same thread. Older installed input services do not attach our marker,
// so handle all caption button clicks without that loop. Keep native hit
// testing and system commands for both local and remote input.
class RemoteCaptionButtons {
 public:
  std::optional<LRESULT> HandleMessage(HWND hwnd, UINT message, WPARAM wparam,
                                       LPARAM lparam) {
    switch (message) {
      case WM_NCLBUTTONDOWN:
      case WM_NCLBUTTONDBLCLK:
        if (!IsButton(wparam)) {
          return std::nullopt;
        }
        Cancel(hwnd);
        pressed_ = static_cast<int>(wparam);
        SetCapture(hwnd);
        if (GetCapture() != hwnd) pressed_ = HTNOWHERE;
        return 0;

      case WM_LBUTTONUP:
      case WM_NCLBUTTONUP: {
        if (pressed_ == HTNOWHERE) return std::nullopt;
        const int pressed = pressed_;
        POINT point{GET_X_LPARAM(lparam), GET_Y_LPARAM(lparam)};
        if (message == WM_LBUTTONUP) ClientToScreen(hwnd, &point);
        const LPARAM screen_point = MAKELPARAM(point.x, point.y);
        Cancel(hwnd);
        // DWM owns the modern caption buttons. A synthetic WM_NCHITTEST
        // can report HTCAPTION even after HTMINBUTTON on the real down.
        // Query the native accessible button bounds for the release point.
        TITLEBARINFOEX titlebar{};
        titlebar.cbSize = sizeof(titlebar);
        SendMessage(hwnd, WM_GETTITLEBARINFOEX, 0,
                    reinterpret_cast<LPARAM>(&titlebar));
        LRESULT hit = HTNOWHERE;
        const int index = pressed == HTMINBUTTON ? 2 : pressed == HTMAXBUTTON ? 3 : 5;
        if (PtInRect(&titlebar.rgrect[index], point) &&
            !(titlebar.rgstate[index] & (STATE_SYSTEM_INVISIBLE | STATE_SYSTEM_UNAVAILABLE))) {
          hit = pressed;
        } else if (!DwmDefWindowProc(hwnd, WM_NCHITTEST, 0, screen_point, &hit)) {
          hit = SendMessage(hwnd, WM_NCHITTEST, 0, screen_point);
        }
        if (hit == pressed) {
          const WPARAM command = pressed == HTMINBUTTON ? SC_MINIMIZE
              : pressed == HTCLOSE ? SC_CLOSE
              : IsZoomed(hwnd) ? SC_RESTORE : SC_MAXIMIZE;
          const HMENU menu = GetSystemMenu(hwnd, FALSE);
          const UINT state = menu ? GetMenuState(menu, static_cast<UINT>(command),
                                                MF_BYCOMMAND) : 0;
          if (state != static_cast<UINT>(-1) &&
              !(state & (MF_DISABLED | MF_GRAYED))) {
            // Keep WM_CLOSE/window_manager's hide-to-tray handling intact.
            PostMessage(hwnd, WM_SYSCOMMAND, command, screen_point);
          }
        }
        return 0;
      }
      case WM_CAPTURECHANGED:
        pressed_ = HTNOWHERE;
        break;
      case WM_CANCELMODE:
      case WM_DESTROY:
        Cancel(hwnd);
        break;
      case WM_ACTIVATE:
        if (LOWORD(wparam) == WA_INACTIVE) Cancel(hwnd);
        break;
    }
    return std::nullopt;
  }

 private:
  static bool IsButton(WPARAM hit) {
    return hit == HTMINBUTTON || hit == HTMAXBUTTON || hit == HTCLOSE;
  }

  void Cancel(HWND hwnd) {
    if (pressed_ == HTNOWHERE) return;
    pressed_ = HTNOWHERE;
    if (GetCapture() == hwnd) ReleaseCapture();
  }

  int pressed_ = HTNOWHERE;
};

#endif  // WEBDESK_REMOTE_CAPTION_BUTTONS_H_
