#pragma once
#include <windows.h>

// Notification-area menus must have a foreground owner even when the main
// window is hidden. This activates ownership without showing/restoring the app.
// WM_NULL after tracking is required for subsequent invocations to dismiss
// correctly. See Microsoft's TrackPopupMenu "Remarks".
inline UINT ShowTrayContextMenu(HWND owner, HMENU menu, POINT position) {
  SetForegroundWindow(owner);
  const UINT command = static_cast<UINT>(TrackPopupMenu(
      menu, TPM_BOTTOMALIGN | TPM_LEFTALIGN | TPM_RIGHTBUTTON |
                TPM_RETURNCMD | TPM_NONOTIFY,
      position.x, position.y, 0, owner, nullptr));
  PostMessage(owner, WM_NULL, 0, 0);
  return command;
}
