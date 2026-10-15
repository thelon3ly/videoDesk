# VideoDesk

Save a public video or its audio to the device you are using. Paste one URL, preview it when the source allows playback, choose a video quality or audio format, then download. The Android app works on the phone without a computer.

Use VideoDesk only for videos you are allowed to save. Private, paywalled, and DRM protected streams are not supported. Site support depends on yt-dlp and can change.

## Download the apps

- [Windows 10/11 installer (64-bit)](https://github.com/thelon3ly/videoDesk/releases/download/v1.0.0/VideoDesk-Windows-Setup.exe)
- [Windows 7 SP1 installer (64-bit)](https://github.com/thelon3ly/videoDesk/releases/download/v1.0.0/VideoDesk-Windows7-Setup.exe)
- [Android APK (Android 10 or newer)](https://github.com/thelon3ly/videoDesk/releases/download/v1.0.0/VideoDesk-Android.apk)

The Android APK is development-signed and the Windows installer is unsigned. Both downloads are also listed on the [VideoDesk 1.0.0 release page](https://github.com/thelon3ly/videoDesk/releases/tag/v1.0.0).

## Project layout

- `android/` — native Android app with an on-device yt-dlp and FFmpeg backend.
- `windows/` — local Windows server, browser interface, and standard installer build script.
- `windows7/` — separate build instructions and installer script for Windows 7 SP1 (64-bit).
- `cloud/` — container server for public video pages on an online host.

## Online video pages

The GitHub Pages edition handles direct media files. Video page links such as YouTube need a running server to inspect formats and prepare the download. The included container serves the full VideoDesk interface and accepts public Internet Archive, YouTube, Vimeo, TikTok, and Dailymotion links. It saves completed downloads for one hour; the visitor's browser then saves the file to their phone or computer. Availability still depends on each source and yt-dlp.

Use the [GitHub Pages app](https://thelon3ly.github.io/videoDesk/) to paste a link. Supported video pages open in the [online downloader](https://videodesk-online.onrender.com/) for quality and audio choices when the source permits cloud access. YouTube has returned rate limits and bot sign-in checks from Render, so YouTube downloads through this host are not reliable; the installed Android or Windows app may work from your device. Do not send browser cookies or account credentials to the public service. The Render Free plan spins down after inactivity and has usage limits. The service uses temporary storage and limits downloads to 250 MB, two simultaneous jobs, and eight downloads per visitor per hour. See `render.yaml` to deploy your own instance.

## Android

Install JDK 17, Android SDK 36, and Gradle 8.13. From `android/`, run:

```text
gradle assembleDebug
```

The APK is created at `android/app/build/outputs/apk/debug/app-debug.apk`. The Android app uses [youtubedl-android](https://github.com/yausername/youtubedl-android) version 0.18.1.

## Windows

For a source run, install Python 3.10 or newer and run `windows/start-windows.bat`. It creates a local environment, installs the Python requirements, and opens VideoDesk at `http://localhost:8765`.

To build a Windows installer, install PyInstaller and Inno Setup, obtain the official yt-dlp and FFmpeg Windows executables, then use `windows/build.ps1`. Pass the paths to those executables and to Inno Setup's `ISCC.exe`. The generated installer goes into `dist/installers/`.

## Windows 7

Download the [Windows 7 SP1 installer](https://github.com/thelon3ly/videoDesk/releases/download/v1.0.0/VideoDesk-Windows7-Setup.exe), or see [windows7/README.md](windows7/README.md) for build details. This edition needs Windows 7 SP1 (64-bit) and older compatible dependencies. Its 2024 yt-dlp release cannot reliably support today's video sites; direct media links are the best fit. The Windows 7 build has not been tested on a Windows 7 machine.

## License

VideoDesk source is GPL-3.0; see [COPYING](COPYING). Bundled third-party tools retain their own licenses.
