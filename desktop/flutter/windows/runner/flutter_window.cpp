#include "flutter_window.h"

#include <optional>

#include "flutter/generated_plugin_registrant.h"
#include "utils.h"

FlutterWindow::FlutterWindow(const flutter::DartProject& project)
    : project_(project) {}

FlutterWindow::~FlutterWindow() {}

bool FlutterWindow::OnCreate() {
  if (!Win32Window::OnCreate()) {
    return false;
  }

  RECT frame = GetClientArea();

  // The size here must match the window dimensions to avoid unnecessary surface
  // creation / destruction in the startup path.
  flutter_controller_ = std::make_unique<flutter::FlutterViewController>(
      frame.right - frame.left, frame.bottom - frame.top, project_);
  // Ensure that basic setup of the controller was successful.
  if (!flutter_controller_->engine() || !flutter_controller_->view()) {
    return false;
  }
  file_selection_ = std::make_unique<FileSelection>();
  RegisterPlugins(flutter_controller_->engine());
  lifecycle_ =
      std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
          flutter_controller_->engine()->messenger(), "webdesk/lifecycle",
          &flutter::StandardMethodCodec::GetInstance());
  lifecycle_->SetMethodCallHandler([this](const auto& call, auto result) {
    if (call.method_name() == "holdAwake") {
      const auto enabled =
          call.arguments() ? std::get_if<bool>(call.arguments()) : nullptr;
      if (!enabled) {
        result->Error("Arguments", "Expected boolean");
        return;
      }
      SetThreadExecutionState(
          ES_CONTINUOUS |
          (*enabled ? ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED : 0));
      result->Success();
    } else if (call.method_name() == "selectFile" ||
               call.method_name() == "cancelFileSelection") {
      const auto token = call.arguments()
                             ? std::get_if<std::string>(call.arguments())
                             : nullptr;
      if (!token || token->empty() || token->size() > 64) {
        result->Error("Arguments", "Expected file selection owner");
        return;
      }
      if (!file_selection_ || !IsWindow(GetHandle())) {
        result->Error("FileSelectionUnavailable",
                      "File selection window is unavailable");
        return;
      }
      if (call.method_name() == "cancelFileSelection") {
        file_selection_->Cancel(*token);
        result->Success();
        return;
      }
      auto reply =
          std::shared_ptr<flutter::MethodResult<flutter::EncodableValue>>(
              std::move(result));
      try {
        if (!file_selection_->Open(
                GetHandle(), *token, [reply](FileSelection::Outcome outcome) {
                  if (outcome.status == HRESULT_FROM_WIN32(ERROR_CANCELLED)) {
                    reply->Success();
                  } else if (FAILED(outcome.status)) {
                    reply->Error("FileSelection", "Could not select file",
                                 flutter::EncodableValue(
                                     static_cast<int64_t>(outcome.status)));
                  } else {
                    const auto path = Utf8FromUtf16(outcome.path.c_str());
                    if (path.empty())
                      reply->Error("FileSelection", "Invalid file path");
                    else
                      reply->Success(flutter::EncodableValue(path));
                  }
                }))
          reply->Error("FileSelection", "A file selection is already open");
      } catch (const std::exception& error) {
        reply->Error("FileSelection", error.what());
      }
    } else {
      result->NotImplemented();
    }
  });
  SetChildContent(flutter_controller_->view()->GetNativeWindow());

  flutter_controller_->engine()->SetNextFrameCallback([&]() { this->Show(); });

  // Flutter can complete the first frame before the "show window" callback is
  // registered. The following call ensures a frame is pending to ensure the
  // window is shown. It is a no-op if the first frame hasn't completed yet.
  flutter_controller_->ForceRedraw();

  return true;
}

void FlutterWindow::OnDestroy() {
  if (file_selection_) {
    file_selection_->Shutdown();
    file_selection_.reset();
  }
  SetThreadExecutionState(ES_CONTINUOUS);
  lifecycle_.reset();
  if (flutter_controller_) {
    flutter_controller_ = nullptr;
  }

  Win32Window::OnDestroy();
}

LRESULT
FlutterWindow::MessageHandler(HWND hwnd, UINT const message,
                              WPARAM const wparam,
                              LPARAM const lparam) noexcept {
  if (message == FileSelection::kCompleted) {
    if (file_selection_) file_selection_->Complete();
    return 0;
  }
  // Handle caption clicks (including legacy untagged remote input) before
  // the native/plugin window procs
  // can enter a modal mouse-tracking loop on the RTC dispatch thread.
  if (auto result = remote_caption_buttons_.HandleMessage(hwnd, message, wparam,
                                                          lparam)) {
    return *result;
  }

  // Give Flutter, including plugins, an opportunity to handle window messages.
  if (flutter_controller_) {
    std::optional<LRESULT> result =
        flutter_controller_->HandleTopLevelWindowProc(hwnd, message, wparam,
                                                      lparam);
    if (result) {
      return *result;
    }
  }

  switch (message) {
    case WM_POWERBROADCAST:
      if (lifecycle_ &&
          (wparam == PBT_APMSUSPEND || wparam == PBT_APMRESUMEAUTOMATIC)) {
        lifecycle_->InvokeMethod(
            wparam == PBT_APMSUSPEND ? "suspend" : "resume", nullptr);
      }
      break;
    case WM_FONTCHANGE:
      if (flutter_controller_ && flutter_controller_->engine())
        flutter_controller_->engine()->ReloadSystemFonts();
      break;
  }

  return Win32Window::MessageHandler(hwnd, message, wparam, lparam);
}
