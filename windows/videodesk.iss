[Setup]
AppId={{7BB4E86D-4E89-4BF0-A761-B508EC33FB8B}
AppName=VideoDesk
AppVersion=1.0.0
AppPublisher=VideoDesk
DefaultDirName={localappdata}\Programs\VideoDesk
DefaultGroupName=VideoDesk
PrivilegesRequired=lowest
OutputDir=..\dist\installers
OutputBaseFilename=VideoDesk-Windows-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=videodesk.ico
UninstallDisplayIcon={app}\VideoDesk.exe
ArchitecturesAllowed=x64compatible

[Files]
Source: "..\dist\windows\VideoDesk\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\VideoDesk"; Filename: "{app}\VideoDesk.exe"
Name: "{autodesktop}\VideoDesk"; Filename: "{app}\VideoDesk.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Run]
Filename: "{app}\VideoDesk.exe"; Description: "Launch VideoDesk"; Flags: nowait postinstall skipifsilent
