#if !defined(InstallerPreview) && !defined(PayloadDir)
  #error PayloadDir is required
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif
[Setup]
AppId={{FC577D56-9519-4807-887C-BAE813CB83BD}
AppName=WebDesk
AppVersion={#AppVersion}
AppPublisher=WebDesk
DefaultDirName={autopf}\WebDesk
DefaultGroupName=WebDesk
DisableProgramGroupPage=yes
DisableWelcomePage=yes
DisableReadyPage=yes
DisableDirPage=no
AppendDefaultDirName=yes
#ifdef InstallerPreview
PrivilegesRequired=lowest
CreateAppDir=no
UsePreviousAppDir=no
Uninstallable=no
CloseApplications=no
OutputDir=..\..\test-results\installer-preview
OutputBaseFilename=WebDesk-Installer-Preview
#else
PrivilegesRequired=admin
Uninstallable=yes
CloseApplications=yes
OutputDir=..\..\flutter-release\{#AppVersion}
OutputBaseFilename=WebDesk-{#AppVersion}-win-x64
#endif
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
WizardSizePercent=100
Compression=lzma2/normal
SolidCompression=yes
SetupIconFile=..\icons\webdesk.ico
UninstallDisplayIcon={app}\WebDesk.exe
RestartApplications=no
ShowLanguageDialog=no
LanguageDetectionMethod=none

[Languages]
Name: "chinesesimp"; MessagesFile: "ChineseSimplified.isl"

#ifndef InstallerPreview
[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\WebDesk"; Filename: "{app}\WebDesk.exe"
Name: "{autodesktop}\WebDesk"; Filename: "{app}\WebDesk.exe"

[Run]
Filename: "{app}\WebDesk.exe"; Description: "打开 WebDesk"; Flags: postinstall nowait skipifsilent runascurrentuser

[UninstallRun]
Filename: "{app}\native\WebDeskNative.exe"; Parameters: "--uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "WebDeskNative"
#endif

[Messages]
#ifdef InstallerPreview
SetupAppTitle=安装界面预览
SetupWindowTitle=WebDesk 安装界面预览
#endif
WizardSelectDir=选择安装位置
SelectDirDesc=将安装到下面的文件夹
SelectDirLabel3=
SelectDirBrowseLabel=
ButtonInstall=安装(&I)
WizardInstalling=正在安装
InstallingLabel=正在解压文件…
FinishedHeadingLabel=安装完成
FinishedLabelNoIcons=
FinishedLabel=

[Code]
#ifdef InstallerPreview
var
  PreviewDirectoryPage: TWizardPage;
  PreviewOpenCheckBox: TNewCheckBox;
  PreviewInstallDir: String;
#endif

const
  WindowClientHeight = 280;
  ContentMargin = 24;
  HeadingTop = 24;
  DescriptionTop = 60;
  ContentTop = 108;
  ButtonGap = 8;
  ProgressHeight = 18;

procedure StyleHeading(LabelControl: TNewStaticText; ContentWidth: Integer);
begin
  LabelControl.SetBounds(ScaleX(ContentMargin), ScaleY(HeadingTop),
    ContentWidth, ScaleY(28));
  LabelControl.Font.Assign(WizardForm.Font);
  LabelControl.Font.Size := 14;
  LabelControl.Font.Style := [fsBold];
end;

procedure StyleDescription(LabelControl: TNewStaticText; ContentWidth: Integer);
begin
  LabelControl.Font.Assign(WizardForm.Font);
  LabelControl.SetBounds(ScaleX(ContentMargin), ScaleY(DescriptionTop),
    ContentWidth, ScaleY(32));
end;

procedure LayoutFooter;
var
  ButtonWidth, ButtonHeight, ButtonTop, RightEdge: Integer;
begin
  ButtonWidth := ScaleX(80);
  ButtonHeight := ScaleY(26);
  ButtonTop := WizardForm.Bevel.Top +
    (WizardForm.ClientHeight - WizardForm.Bevel.Top - ButtonHeight) div 2;
  RightEdge := WizardForm.ClientWidth - ScaleX(ContentMargin);
  WizardForm.CancelButton.SetBounds(RightEdge - ButtonWidth,
    ButtonTop, ButtonWidth, ButtonHeight);
  { Inno hides Cancel on completion, but keeps Next in its old slot. }
  if WizardForm.CancelButton.Visible then
    RightEdge := WizardForm.CancelButton.Left - ScaleX(ButtonGap);
  WizardForm.NextButton.SetBounds(RightEdge - ButtonWidth,
    ButtonTop, ButtonWidth, ButtonHeight);
  WizardForm.BackButton.SetBounds(
    WizardForm.NextButton.Left - ScaleX(ButtonGap) - ButtonWidth,
    ButtonTop, ButtonWidth, ButtonHeight);
end;

procedure InitializeWizard;
var
  ContentWidth: Integer;
begin
  { Keep the native footer anchored while removing unused vertical space. }
  WizardForm.ClientHeight := ScaleY(WindowClientHeight);
  ContentWidth := WizardForm.ClientWidth - ScaleX(ContentMargin * 2);
  WizardForm.Color := clBtnFace;
  WizardForm.InnerPage.Color := clWhite;
  WizardForm.SelectDirPage.Color := clWhite;
  WizardForm.PreparingPage.Color := clWhite;
  WizardForm.InstallingPage.Color := clWhite;
  WizardForm.FinishedPage.Color := clWhite;
  WizardForm.MainPanel.Color := clWhite;
  WizardForm.Bevel1.Visible := False;
  WizardForm.WizardSmallBitmapImage.Visible := False;
  WizardForm.WizardBitmapImage.Visible := False;
  WizardForm.WizardBitmapImage2.Visible := False;
  WizardForm.SelectDirBitmapImage.Visible := False;

  WizardForm.MainPanel.Height := ScaleY(ContentTop);
  StyleHeading(WizardForm.PageNameLabel, ContentWidth);
  StyleHeading(WizardForm.FinishedHeadingLabel, ContentWidth);
  StyleDescription(WizardForm.PageDescriptionLabel, ContentWidth);
  WizardForm.InnerNotebook.SetBounds(ScaleX(ContentMargin),
    ScaleY(ContentTop), ContentWidth,
    WizardForm.OuterNotebook.ClientHeight - ScaleY(ContentTop + ContentMargin));

  WizardForm.FinishedLabel.Font.Assign(WizardForm.Font);
  WizardForm.RunList.Font.Assign(WizardForm.Font);
  WizardForm.RunList.Color := clWhite;
  WizardForm.SelectDirLabel.Visible := False;
  WizardForm.SelectDirBrowseLabel.Visible := False;
  WizardForm.DirBrowseButton.Width := ScaleX(80);
  WizardForm.DirBrowseButton.Height := ScaleY(26);
  WizardForm.DirBrowseButton.Left := ContentWidth - WizardForm.DirBrowseButton.Width;
  WizardForm.DirBrowseButton.Top := 0;
  WizardForm.DirEdit.SetBounds(0, 0,
    WizardForm.DirBrowseButton.Left - ScaleX(ButtonGap), ScaleY(26));
  { Keep Inno's live operation and destination labels, in the shared description
    area. Do not replace them with a fixed "extracting" caption. }
  WizardForm.StatusLabel.Parent := WizardForm.MainPanel;
  WizardForm.StatusLabel.Font.Assign(WizardForm.Font);
  WizardForm.StatusLabel.SetBounds(ScaleX(ContentMargin), ScaleY(DescriptionTop),
    ContentWidth, ScaleY(18));
  WizardForm.FilenameLabel.Parent := WizardForm.MainPanel;
  WizardForm.FilenameLabel.Font.Assign(WizardForm.Font);
  WizardForm.FilenameLabel.SetBounds(ScaleX(ContentMargin), ScaleY(DescriptionTop + 20),
    ContentWidth, ScaleY(18));
  WizardForm.StatusLabel.Visible := False;
  WizardForm.FilenameLabel.Visible := False;
  WizardForm.ProgressGauge.SetBounds(0, 0, ContentWidth, ScaleY(ProgressHeight));
#ifdef InstallerPreview
  { CreateAppDir=no skips Inno's directory page. Reuse its actual controls on
    a preview page, so browsing works without ever creating the chosen path. }
  PreviewDirectoryPage := CreateCustomPage(wpWelcome,
    SetupMessage(msgWizardSelectDir), SetupMessage(msgSelectDirDesc));
  PreviewDirectoryPage.Surface.Color := clWhite;
  WizardForm.DirEdit.Parent := PreviewDirectoryPage.Surface;
  WizardForm.DirEdit.Text := ExpandConstant('{autopf}\WebDesk');
  WizardForm.DirBrowseButton.Parent := PreviewDirectoryPage.Surface;
  PreviewOpenCheckBox := TNewCheckBox.Create(WizardForm);
  PreviewOpenCheckBox.Parent := WizardForm.FinishedPage;
  PreviewOpenCheckBox.Caption := '打开 WebDesk';
  PreviewOpenCheckBox.Checked := True;
#endif
end;

procedure CurPageChanged(CurPageID: Integer);
var
  ContentWidth, OptionsTop: Integer;
begin
  LayoutFooter;
  ContentWidth := WizardForm.ClientWidth - ScaleX(ContentMargin * 2);
  { Inno adjusts labels when entering pages; reapply the shared text grid. }
  StyleHeading(WizardForm.PageNameLabel, ContentWidth);
  StyleDescription(WizardForm.PageDescriptionLabel, ContentWidth);
  WizardForm.PageDescriptionLabel.Visible := CurPageID <> wpInstalling;
  WizardForm.StatusLabel.Visible := CurPageID = wpInstalling;
  WizardForm.FilenameLabel.Visible := CurPageID = wpInstalling;
#ifdef InstallerPreview
  if CurPageID = PreviewDirectoryPage.ID then
    WizardForm.NextButton.Caption := SetupMessage(msgButtonInstall);
#endif
  if CurPageID = wpFinished then begin
    { Apply after Inno has populated and positioned the completion controls. }
    ContentWidth := WizardForm.FinishedPage.ClientWidth - ScaleX(ContentMargin * 2);
    StyleHeading(WizardForm.FinishedHeadingLabel, ContentWidth);
    { Empty FinishedLabel messages still leave Inno's paragraph separators
      before the standard finish instruction. Trim those, not just its bounds. }
    WizardForm.FinishedLabel.Caption := Trim(WizardForm.FinishedLabel.Caption);
    StyleDescription(WizardForm.FinishedLabel, ContentWidth);
    WizardForm.AdjustLabelHeight(WizardForm.FinishedLabel);
    OptionsTop := WizardForm.FinishedLabel.Top +
      WizardForm.FinishedLabel.Height + ScaleY(16);
    if OptionsTop < ScaleY(ContentTop) then
      OptionsTop := ScaleY(ContentTop);
    WizardForm.RunList.SetBounds(ScaleX(ContentMargin), OptionsTop,
      ContentWidth, WizardForm.FinishedPage.ClientHeight - OptionsTop - ScaleY(ContentMargin));
#ifdef InstallerPreview
    { Use a visual-only checkbox, not RunList: Inno binds RunList items to [Run]. }
    PreviewOpenCheckBox.SetBounds(ScaleX(ContentMargin), OptionsTop,
      ContentWidth, ScaleY(24));
#endif
    { Preserve Inno's reboot choices if an upgrade requires restarting Windows. }
    WizardForm.YesRadio.SetBounds(ScaleX(ContentMargin), OptionsTop,
      ContentWidth, ScaleY(20));
    WizardForm.NoRadio.SetBounds(ScaleX(ContentMargin), OptionsTop + ScaleY(28),
      ContentWidth, ScaleY(20));
  end;
end;

#ifdef InstallerPreview
function NextButtonClick(CurPageID: Integer): Boolean;
begin
  if CurPageID = PreviewDirectoryPage.ID then begin
    PreviewInstallDir := WizardForm.DirEdit.Text;
    { Inno may ensure DirEdit exists even with CreateAppDir=no. Keep the
      selected directory display-only and use its existing temporary folder. }
    WizardForm.DirEdit.Text := ExpandConstant('{tmp}');
  end;
  Result := True;
end;
#endif

procedure CurStepChanged(CurStep: TSetupStep);
#ifdef InstallerPreview
var
  Progress: Integer;
  PreviewFile: String;
begin
  if CurStep = ssInstall then begin
    WizardForm.ProgressGauge.Min := 0;
    WizardForm.ProgressGauge.Max := 100;
    for Progress := 0 to 100 do begin
      if Progress < 80 then begin
        case Progress div 16 of
          0: PreviewFile := 'WebDesk.exe';
          1: PreviewFile := 'flutter_windows.dll';
          2: PreviewFile := 'libwebrtc.dll';
          3: PreviewFile := 'data\flutter_assets\AssetManifest.bin';
          4: PreviewFile := 'native\WebDeskNative.exe';
        end;
        WizardForm.StatusLabel.Caption := '正在解压文件…';
        WizardForm.FilenameLabel.Caption := AddBackslash(PreviewInstallDir) + PreviewFile;
      end else if Progress < 90 then begin
        WizardForm.StatusLabel.Caption := '正在创建快捷方式…';
        WizardForm.FilenameLabel.Caption := ExpandConstant('{autodesktop}\WebDesk.lnk');
      end else begin
        WizardForm.StatusLabel.Caption := '正在配置桌面服务…';
        WizardForm.FilenameLabel.Caption := AddBackslash(PreviewInstallDir) + 'native\WebDeskNative.exe';
      end;
      WizardForm.ProgressGauge.Position := Progress;
      WizardForm.Refresh;
      Sleep(70);
    end;
  end;
end;
#else
var ResultCode: Integer;
begin
  if CurStep = ssPostInstall then begin
    WizardForm.StatusLabel.Caption := '正在配置桌面服务…';
    WizardForm.FilenameLabel.Caption := ExpandConstant('{app}\native\WebDeskNative.exe');
    WizardForm.Refresh;
    if not Exec(ExpandConstant('{app}\native\WebDeskNative.exe'), '--install "' + ExpandConstant('{app}\WebDesk.exe') + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
      RaiseException('桌面服务配置失败，请重新运行安装程序。');
  end;
end;
#endif
