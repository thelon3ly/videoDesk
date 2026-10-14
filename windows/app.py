"""Local, device-owned video downloader UI."""

from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
PORT = int(os.environ.get("VIDEO_APP_PORT", "8765"))
JOBS: dict[str, dict] = {}
LOCK = threading.Lock()
MAX_BODY = 16_384
AUDIO_PRESETS = {
    "audio-original": ("best", None),
    "audio-mp3-high": ("mp3", "192K"),
    "audio-mp3-small": ("mp3", "96K"),
}


def ytdlp_command() -> list[str]:
    if getattr(sys, "frozen", False):
        return [str(ROOT / "yt-dlp.exe")]
    return [sys.executable, "-m", "yt_dlp"]


def ffmpeg_path() -> str | None:
    bundled_binary = ROOT / "ffmpeg.exe"
    if bundled_binary.is_file():
        return str(bundled_binary)
    system_binary = shutil.which("ffmpeg")
    if system_binary:
        return system_binary
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except (ImportError, RuntimeError):
        return None


def valid_url(value: object) -> str:
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError("Paste one video URL (up to 2,048 characters).")
    url = value.strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Enter a valid http:// or https:// video URL without credentials.")
    return url


def yt_dlp(*args: str, timeout: int | None = None) -> subprocess.CompletedProcess:
    ffmpeg = ffmpeg_path()
    runtime = os.environ.get("VIDEO_APP_JS_RUNTIME")
    js_runtime = ["--js-runtimes", runtime] if runtime else []
    return subprocess.run(
        [*ytdlp_command(), "--ignore-config", "--no-playlist", *js_runtime, *(["--ffmpeg-location", ffmpeg] if ffmpeg else []), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )


def readable_error(stderr: str) -> str:
    if "[youtube]" in stderr and "HTTP Error 429" in stderr:
        return "YouTube is limiting requests from this server. Try the Android or Windows app on your device."
    lines = [x.strip() for x in stderr.splitlines() if x.strip()]
    errors = [x for x in lines if "ERROR:" in x]
    message = (errors[-1] if errors else (lines[-1] if lines else "The source did not provide a downloadable video."))
    return message[:500]


def browser_preview(info: dict, formats: list[dict]) -> dict:
    extractor = str(info.get("extractor_key") or "").lower()
    video_id = str(info.get("id") or "")
    if extractor == "youtube" and re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        return {"kind": "embed", "url": f"https://www.youtube.com/embed/{video_id}"}
    playable = [
        f for f in formats
        if f.get("ext") in ("mp4", "webm", "mov", "m4v")
        and f.get("vcodec") != "none"
        and f.get("acodec") != "none"
        and str(f.get("url") or "").startswith(("http://", "https://"))
        and f.get("protocol") in (None, "http", "https")
    ]
    if playable:
        chosen = max(playable, key=lambda f: (int(f.get("height") or 0), float(f.get("tbr") or 0)))
        return {"kind": "video", "url": chosen["url"]}
    return {"kind": "unavailable"}


def inspect(url: str) -> dict:
    result = yt_dlp("--dump-single-json", "--skip-download", url, timeout=70)
    if result.returncode:
        raise ValueError(readable_error(result.stderr))
    try:
        info = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise ValueError("Could not read video details from this source.") from None
    if info.get("_type") in ("playlist", "multi_video"):
        raise ValueError("Paste a single video URL rather than a playlist.")
    formats = info.get("formats") or [info]
    video_exts = {"mp4", "webm", "mkv", "mov", "m4v", "avi", "flv", "ts"}
    video = [f for f in formats if f.get("format_id") and (f.get("vcodec") not in (None, "none") or (f.get("vcodec") is None and f.get("ext") in video_exts))]
    audio = [f for f in formats if f.get("acodec") not in (None, "none") and f.get("vcodec") == "none" and f.get("format_id")]
    ffmpeg = ffmpeg_path() is not None
    if ffmpeg and audio:
        best_audio = max(audio, key=lambda f: (float(f.get("abr") or 0), float(f.get("tbr") or 0)))["format_id"]
    else:
        best_audio = None

    by_height: dict[int, dict] = {}
    for f in video:
        height = int(f.get("height") or 0)
        if height < 1:
            continue
        has_audio = f.get("acodec") != "none"
        if not has_audio and not best_audio:
            continue
        score = (float(f.get("tbr") or 0), float(f.get("filesize") or f.get("filesize_approx") or 0))
        previous = by_height.get(height)
        if previous is None or score > previous["_score"]:
            by_height[height] = {
                "id": str(f["format_id"]) + ("+" + str(best_audio) if not has_audio else ""),
                "label": f"{height}p",
                "ext": str(f.get("ext") or "video").upper(),
                "merged": not has_audio,
                "size": f.get("filesize") or f.get("filesize_approx"),
                "_score": score,
            }
    options = [{k: v for k, v in entry.items() if k != "_score"} for _, entry in sorted(by_height.items(), reverse=True)]
    if not options and video:
        for f in video:
            if f.get("acodec") != "none":
                options.append({"id": str(f["format_id"]), "label": f.get("format_note") or "Original", "ext": str(f.get("ext") or "video").upper(), "merged": False, "size": f.get("filesize")})
                break
    audio_exts = {"mp3", "m4a", "aac", "ogg", "opus", "flac", "wav", "weba"}
    has_audio = any(
        f.get("acodec") not in (None, "none")
        or (f.get("acodec") is None and f.get("ext") in video_exts | audio_exts)
        for f in formats
    )
    audio_options = [
        {"id": "audio-original", "label": "Original audio", "ext": "SOURCE", "size": None},
        {"id": "audio-mp3-high", "label": "MP3 · 192 kbps", "ext": "MP3", "size": None},
        {"id": "audio-mp3-small", "label": "MP3 · 96 kbps", "ext": "MP3", "size": None},
    ] if has_audio and ffmpeg else []
    if not options and not audio_options:
        detail = "FFmpeg is needed to extract audio from this source." if has_audio and not ffmpeg else "No downloadable video or audio format was found."
        raise ValueError(detail)
    return {
        "title": str(info.get("title") or "Untitled video")[:250],
        "source": str(info.get("extractor_key") or urlparse(url).hostname),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail") if str(info.get("thumbnail") or "").startswith("https://") else None,
        "webpage_url": info.get("webpage_url") if str(info.get("webpage_url") or "").startswith(("http://", "https://")) else url,
        "preview": browser_preview(info, formats),
        "options": options[:30],
        "audio_options": audio_options,
        "ffmpeg": ffmpeg,
    }


def run_download(job_id: str, url: str, format_id: str, kind: str) -> None:
    with LOCK:
        job = JOBS[job_id]
        folder = job["folder"]
        job["status"] = "downloading"
    ffmpeg = ffmpeg_path()
    if kind == "audio":
        audio_format, quality = AUDIO_PRESETS[format_id]
        format_args = ["--format", "bestaudio/best", "--extract-audio", "--audio-format", audio_format]
        if quality:
            format_args += ["--audio-quality", quality]
    else:
        format_args = ["--format", format_id, "--merge-output-format", "mp4/mkv"]
    runtime = os.environ.get("VIDEO_APP_JS_RUNTIME")
    js_runtime = ["--js-runtimes", runtime] if runtime else []
    max_mb = int(os.environ.get("VIDEO_APP_MAX_MB", "0"))
    size_limit = ["--max-filesize", f"{max_mb}M"] if max_mb > 0 else []
    args = [*ytdlp_command(), "--ignore-config", "--no-playlist", *js_runtime, *(["--ffmpeg-location", ffmpeg] if ffmpeg else []), "--newline", "--no-warnings", *size_limit, *format_args, "--output", str(folder / "%(title).180B [%(id)s].%(ext)s"), url]
    errors: list[str] = []
    try:
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", bufsize=1)
        max_seconds = int(os.environ.get("VIDEO_APP_MAX_SECONDS", "0"))
        timer = threading.Timer(max_seconds, process.kill) if max_seconds > 0 else None
        if timer:
            timer.start()
        assert process.stdout is not None
        try:
            for line in process.stdout:
                line = line.strip()
                if "ERROR:" in line:
                    errors.append(line)
                match = re.search(r"\[download\]\s+([\d.]+)%", line)
                if match:
                    with LOCK:
                        job["progress"] = min(99, float(match.group(1)))
            code = process.wait(timeout=1800)
        finally:
            if timer:
                timer.cancel()
        if code:
            raise RuntimeError(errors[-1] if errors else "Download failed. The source may have changed or restricted access.")
        files = [p for p in folder.iterdir() if p.is_file() and not p.name.endswith((".part", ".ytdl"))]
        if not files:
            raise RuntimeError("Download finished, but no media file was created.")
        chosen = max(files, key=lambda p: p.stat().st_size)
        if max_mb > 0 and chosen.stat().st_size > max_mb * 1024 * 1024:
            chosen.unlink()
            raise RuntimeError(f"The finished file exceeds the {max_mb} MB online limit.")
        with LOCK:
            job.update(status="ready", progress=100, filename=chosen.name, path=str(chosen), size=chosen.stat().st_size)
    except Exception as exc:
        with LOCK:
            job.update(status="error", error=str(exc)[:500])


class Handler(BaseHTTPRequestHandler):
    server_version = "VideoDesk/1.0"

    def log_message(self, format: str, *args: object) -> None:
        pass

    def send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def allowed(self) -> bool:
        host = self.headers.get("Host", "").split(":")[0].strip("[]").lower()
        origin = self.headers.get("Origin")
        if host not in ("localhost", "127.0.0.1", "::1"):
            return False
        return not origin or urlparse(origin).hostname in ("localhost", "127.0.0.1", "::1")

    def body(self) -> dict:
        size = int(self.headers.get("Content-Length", "0"))
        if size < 1 or size > MAX_BODY:
            raise ValueError("Request size is invalid.")
        data = json.loads(self.rfile.read(size))
        if not isinstance(data, dict):
            raise ValueError("Request must be an object.")
        return data

    def do_POST(self) -> None:
        if not self.allowed():
            self.send_json(403, {"error": "Open the app at localhost."})
            return
        try:
            data = self.body()
            if self.path == "/api/inspect":
                url = valid_url(data.get("url"))
                info = inspect(url)
                token = uuid.uuid4().hex
                with LOCK:
                    JOBS[token] = {"url": url, "video_options": {f["id"] for f in info["options"]}, "audio_options": {f["id"] for f in info["audio_options"]}, "status": "inspected", "created": time.time()}
                self.send_json(200, {**info, "token": token})
            elif self.path == "/api/download":
                token, format_id, kind = data.get("token"), data.get("format_id"), data.get("kind", "video")
                with LOCK:
                    prior = JOBS.get(token)
                    if kind not in ("video", "audio") or not prior or format_id not in prior[kind + "_options"] or prior["status"] != "inspected":
                        raise ValueError("Inspect the link and select an available quality first.")
                    folder = Path(tempfile.mkdtemp(prefix="videodesk-"))
                    job_id = uuid.uuid4().hex
                    JOBS[job_id] = {"url": prior["url"], "status": "queued", "progress": 0, "folder": folder, "created": time.time()}
                threading.Thread(target=run_download, args=(job_id, prior["url"], format_id, kind), daemon=True).start()
                self.send_json(202, {"job_id": job_id})
            else:
                self.send_json(404, {"error": "Not found."})
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json(400, {"error": str(exc)})
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": "This source took too long to respond."})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)[:500]})

    def do_GET(self) -> None:
        if not self.allowed():
            self.send_json(403, {"error": "Open the app at localhost."})
            return
        if self.path == "/api/health":
            self.send_json(200, {"ok": True, "yt_dlp": yt_dlp("--version", timeout=5).returncode == 0, "ffmpeg": ffmpeg_path() is not None})
            return
        match = re.fullmatch(r"/api/jobs/([a-f0-9]{32})(/file)?", self.path)
        if match:
            with LOCK:
                job = JOBS.get(match.group(1))
                snapshot = dict(job) if job else None
            if not snapshot:
                self.send_json(404, {"error": "Download not found."})
                return
            if match.group(2):
                if snapshot["status"] != "ready":
                    self.send_json(409, {"error": "Download is not ready."})
                    return
                file = Path(snapshot["path"])
                self.send_response(200)
                self.send_header("Content-Type", mimetypes.guess_type(file.name)[0] or "application/octet-stream")
                self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + __import__("urllib.parse", fromlist=["quote"]).quote(file.name))
                self.send_header("Content-Length", str(file.stat().st_size))
                self.end_headers()
                try:
                    with file.open("rb") as handle:
                        shutil.copyfileobj(handle, self.wfile, 1024 * 1024)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            self.send_json(200, {k: snapshot.get(k) for k in ("status", "progress", "error", "filename", "size")})
            return
        route = self.path.split("?", 1)[0]
        if route == "/":
            route = "/index.html"
        if route not in ("/index.html", "/app.js", "/style.css", "/manifest.webmanifest", "/sw.js", "/icon.svg", "/icon-192.png", "/icon-512.png"):
            self.send_error(404)
            return
        file = PUBLIC / route.lstrip("/")
        body = file.read_bytes()
        self.send_response(200)
        content_type = "application/manifest+json" if file.suffix == ".webmanifest" else (mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    if not getattr(sys, "frozen", False):
        try:
            import yt_dlp as _yt_dlp_package  # noqa: F401
        except ImportError:
            print("yt-dlp is missing. Run: python -m pip install -r requirements.txt")
            raise SystemExit(1)
    address = f"http://localhost:{PORT}"
    print(f"VideoDesk is ready at {address}")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.7, lambda: webbrowser.open(address)).start()
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("Stopped.")
