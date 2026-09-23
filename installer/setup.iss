; Inno Setup Script for Rems Dl
; Automatically detects and installs Microsoft Visual C++ 2015-2022 Redistributable (x64)

#define MyAppName "Rems Dl"
#define MyAppVersion "5.2.0"
#define MyAppPublisher "RemLover-Dev"
#define MyAppURL "https://github.com/RemLover-Dev/Rems-Dl"
#define MyAppExeName "Rems_Dl.exe"
#define MyAppAppUserModelID "RemLoverDev.RemsDl.App.1.0"

[Setup]
AppId={{D37E88A1-8E42-494E-91C7-55097B1A9908}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=..\LICENSE
OutputDir=..\dist_installer
OutputBaseFilename=Rems-Dl-Windows-x64-Setup
SetupIconFile=..\icon\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
; Application binaries and assets from PyInstaller build
Source: "..\dist\Rems_Dl\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Optional bundled VC++ Redistributable (downloaded by CI build or developer)
Source: "..\dependencies\vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall ignoreversion skipifsourcedoesntexist

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon\icon.ico"; AppUserModelID: "{#MyAppAppUserModelID}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\icon\icon.ico"; Tasks: desktopicon; AppUserModelID: "{#MyAppAppUserModelID}"

[Run]
; Install VC++ Redistributable silently if needed and available in {tmp}
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /passive /norestart"; StatusMsg: "Installing Microsoft Visual C++ 2015-2022 Redistributable (x64)..."; Flags: waituntilterminated; Check: ShouldInstallVCRedist

; Launch app after setup completion
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
// Check if 64-bit Visual C++ 2015-2022 Redistributable is installed
function VCRedistNeedsInstall: Boolean;
var
  Installed: Cardinal;
begin
  Result := True;
  // Check native 64-bit registry key
  if RegQueryDWordValue(HKLM, 'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64', 'Installed', Installed) then
  begin
    if Installed = 1 then
      Result := False;
  end;
  // Fallback to WOW6432Node
  if Result and RegQueryDWordValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64', 'Installed', Installed) then
  begin
    if Installed = 1 then
      Result := False;
  end;
end;

function ShouldInstallVCRedist: Boolean;
begin
  Result := FileExists(ExpandConstant('{tmp}\vc_redist.x64.exe')) and VCRedistNeedsInstall();
end;

// Download VC++ runtime if not bundled and needed
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  VCRedistPath: String;
begin
  Result := '';
  VCRedistPath := ExpandConstant('{tmp}\vc_redist.x64.exe');
  if VCRedistNeedsInstall() and not FileExists(VCRedistPath) then
  begin
    // Attempt download using powershell if not bundled
    Exec('powershell.exe', '-NoProfile -Command "Invoke-WebRequest -Uri https://aka.ms/vs/17/release/vc_redist.x64.exe -OutFile ''' + VCRedistPath + '''"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
