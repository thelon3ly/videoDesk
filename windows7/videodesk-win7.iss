[Setup]
AppId={{4E721462-4D42-4F67-918E-5A2E47D49678}
AppName=VideoDesk (Windows 7)
AppVersion=1.0.0
AppPublisher=VideoDesk
DefaultDirName={localappdata}\Programs\VideoDesk-Windows7
DefaultGroupName=VideoDesk (Windows 7)
PrivilegesRequired=lowest
MinVersion=6.1sp1
OutputDir=..\dist\installers
OutputBaseFilename=VideoDesk-Windows7-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\windows\videodesk.ico
UninstallDisplayIcon={app}\VideoDesk.exe
ArchitecturesAllowed=x64compatible

[Files]
Source: "..\dist\windows7\VideoDesk\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\VideoDesk (Windows 7)"; Filename: "{app}\VideoDesk.exe"
Name: "{autodesktop}\VideoDesk (Windows 7)"; Filename: "{app}\VideoDesk.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "{app}\VideoDesk.exe"; Description: "Launch VideoDesk"; Flags: nowait postinstall skipifsilent
