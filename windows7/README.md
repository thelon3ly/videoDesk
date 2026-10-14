# VideoDesk for Windows 7

This edition targets **Windows 7 SP1, 64-bit**. It uses Python 3.8.10, yt-dlp 2024.10.22, and FFmpeg 7.0 because newer versions no longer support Windows 7. The old extractor may fail on current video sites; direct public video links are the most reliable. It has not been tested on an actual Windows 7 machine.

The app source is shared with the standard Windows edition in `../windows/`. To recreate the installer:

1. Install Python 3.8.10 and `pyinstaller==6.14.2` on a Windows build computer.
2. Download `yt-dlp.exe` from the [2024.10.22 release](https://github.com/yt-dlp/yt-dlp/releases/tag/2024.10.22).
3. Extract `ffmpeg.exe` from the [FFmpeg 7.0 essentials build](https://github.com/GyanD/codexffmpeg/releases/tag/7.0).
4. Install Inno Setup, then run `build.ps1` with paths to those three tools.

```powershell
.\windows7\build.ps1 -PythonExe C:\path\to\python.exe -YtDlpExe C:\path\to\yt-dlp.exe -FfmpegExe C:\path\to\ffmpeg.exe -IsccExe C:\path\to\ISCC.exe
```

The installer is written to `dist/installers/VideoDesk-Windows7-Setup.exe`. It uses a separate app ID and installation folder so it can coexist with the standard version. Source licenses are in the root [COPYING](../COPYING); the third-party tools have their own licenses.
