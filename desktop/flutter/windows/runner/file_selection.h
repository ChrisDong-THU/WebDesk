#ifndef WEBDESK_FILE_SELECTION_H_
#define WEBDESK_FILE_SELECTION_H_

#include <shobjidl.h>
#include <windows.h>
#include <wrl/client.h>

#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <thread>

// Keep IFileDialog's modal/caption loops off Flutter's RTC/input dispatch
// thread. The worker owns its COM apartment; completion runs on the UI thread.
class FileSelection {
 public:
  struct Outcome {
    HRESULT status = HRESULT_FROM_WIN32(ERROR_CANCELLED);
    std::wstring path;
  };
  static constexpr UINT kCompleted = WM_APP + 0x341;
  using Completion = std::function<void(Outcome)>;
  FileSelection() = default;
  FileSelection(const FileSelection&) = delete;
  FileSelection& operator=(const FileSelection&) = delete;
  ~FileSelection() { Shutdown(); }

  bool Open(HWND owner, std::string token, Completion completion) {
    if (shutting_down_ || state_ || !IsWindow(owner) || !completion)
      return false;
    auto state = std::make_shared<State>();
    state->owner = owner;
    state->token = std::move(token);
    state_ = state;
    completion_ = std::move(completion);
    try {
      // Capture independent state only: shutdown can revoke UI callbacks and
      // let COM unwind without joining a modal thread from its owner window.
      std::thread([state] { Run(state); }).detach();
    } catch (...) {
      state_.reset();
      completion_ = {};
      throw;
    }
    return true;
  }

  void Complete() {
    if (!state_) return;
    std::optional<Outcome> outcome;
    {
      std::lock_guard<std::mutex> lock(state_->mutex);
      outcome = std::move(state_->outcome);
    }
    if (!outcome) return;
    auto completion = std::move(completion_);
    state_.reset();
    completion(std::move(*outcome));
  }

  void Cancel(const std::string& token) {
    if (!state_ || state_->token != token) return;
    std::lock_guard<std::mutex> lock(state_->mutex);
    CancelLocked(*state_);
    // Keep this slot until completion: repeated cancel/open cannot accumulate
    // STA workers, and a cancelled picker cannot race a new picker for focus.
  }

  void Shutdown() {
    shutting_down_ = true;
    if (!state_) return;
    {
      std::lock_guard<std::mutex> lock(state_->mutex);
      state_->abandoned = true;
      CancelLocked(*state_);
    }
    auto completion = std::move(completion_);
    state_.reset();
    completion(Outcome{});
  }

 private:
  struct State {
    std::mutex mutex;
    HWND owner = nullptr, dialog = nullptr;
    std::string token;
    bool cancelled = false, abandoned = false;
    std::optional<Outcome> outcome;
  };
  inline static thread_local State* current_ = nullptr;

  static void CancelLocked(State& state) {
    state.cancelled = true;
    // The worker hook clears this handle before destruction, under the lock.
    if (state.dialog) {
      PostMessageW(state.dialog, WM_CANCELMODE, 0, 0);
      PostMessageW(state.dialog, WM_CLOSE, 0, 0);
    }
  }

  static LRESULT CALLBACK Observe(int code, WPARAM wparam, LPARAM lparam) {
    if (current_ && (code == HCBT_ACTIVATE || code == HCBT_DESTROYWND)) {
      auto hwnd = reinterpret_cast<HWND>(wparam);
      bool present = false;
      {
        std::lock_guard<std::mutex> lock(current_->mutex);
        if (code == HCBT_DESTROYWND && current_->dialog == hwnd) {
          current_->dialog = nullptr;
        } else if (code == HCBT_ACTIVATE && !current_->dialog &&
                   GetWindow(hwnd, GW_OWNER) == current_->owner) {
          wchar_t name[32]{};
          GetClassNameW(hwnd, name, 32);
          if (wcscmp(name, L"#32770") == 0) {
            current_->dialog = hwnd;
            if (current_->cancelled)
              CancelLocked(*current_);
            else
              present = true;
          }
        }
      }
      // Set only the picker topmost, once, before its normal activation. Its
      // owner may be hidden in the tray or minimized. Preserve that state and
      // the owner's Z order. Do not reactivate inside an activation hook or
      // hold the mutex across synchronous/reentrant window messages.
      if (present)
        SetWindowPos(
            hwnd, HWND_TOPMOST, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
    }
    return CallNextHookEx(nullptr, code, wparam, lparam);
  }

  static Outcome Select(const std::shared_ptr<State>& state) {
    Microsoft::WRL::ComPtr<IFileOpenDialog> dialog;
    Outcome result;
    result.status =
        CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                         IID_PPV_ARGS(&dialog));
    if (FAILED(result.status)) return result;
    FILEOPENDIALOGOPTIONS options{};
    result.status = dialog->GetOptions(&options);
    if (FAILED(result.status)) return result;
    result.status =
        dialog->SetOptions(options | FOS_FORCEFILESYSTEM | FOS_FILEMUSTEXIST |
                           FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR);
    if (FAILED(result.status)) return result;
    result.status = dialog->SetOkButtonLabel(L"\u53d1\u9001");
    if (FAILED(result.status)) return result;
    {
      std::lock_guard<std::mutex> lock(state->mutex);
      if (state->cancelled) return Outcome{};
    }
    result.status = dialog->Show(state->owner);
    if (FAILED(result.status)) return result;
    Microsoft::WRL::ComPtr<IShellItem> item;
    result.status = dialog->GetResult(&item);
    if (FAILED(result.status)) return result;
    PWSTR path = nullptr;
    result.status = item->GetDisplayName(SIGDN_FILESYSPATH, &path);
    const std::unique_ptr<wchar_t, decltype(&CoTaskMemFree)> owned_path(
        path, CoTaskMemFree);
    if (SUCCEEDED(result.status)) {
      if (!path || !*path)
        result.status = E_UNEXPECTED;
      else
        result.path = path;
    }
    return result;
  }

  static void Run(const std::shared_ptr<State>& state) {
    Outcome result;
    const HRESULT initialized = CoInitializeEx(
        nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    result.status = initialized;
    if (SUCCEEDED(initialized)) {
      current_ = state.get();
      const HHOOK hook =
          SetWindowsHookExW(WH_CBT, Observe, nullptr, GetCurrentThreadId());
      if (hook) {
        try {
          result = Select(state);
        } catch (...) {
          result.status = E_FAIL;
        }
        UnhookWindowsHookEx(hook);
      } else {
        result.status = HRESULT_FROM_WIN32(GetLastError());
      }
      current_ = nullptr;
      CoUninitialize();
    }
    std::lock_guard<std::mutex> lock(state->mutex);
    if (state->abandoned) return;
    state->outcome = state->cancelled ? Outcome{} : std::move(result);
    PostMessageW(state->owner, kCompleted, 0, 0);
  }

  std::shared_ptr<State> state_;
  Completion completion_;
  bool shutting_down_ = false;
};

#endif  // WEBDESK_FILE_SELECTION_H_
