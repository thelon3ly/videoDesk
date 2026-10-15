"""Public VideoDesk server for a container host.

The installed Windows edition remains bound to localhost. This module uses the
same extractor and UI with limits appropriate for a small hosted instance.
"""

from __future__ import annotations

import os
import re
import shutil
import threading
import time
from collections import defaultdict, deque
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse

os.environ["VIDEO_APP_CLOUD"] = "1"
from windows import app as local


SUPPORTED_HOSTS = (
    "youtube.com", "youtu.be", "youtube-nocookie.com",
    "vimeo.com", "tiktok.com", "dailymotion.com", "dai.ly", "archive.org",
)
REQUESTS: dict[str, deque[float]] = defaultdict(deque)
REQUEST_LOCK = threading.Lock()
MAX_ACTIVE = 2
FILE_TTL = 60 * 60
TOKEN_TTL = 30 * 60


def supported_url(value: object) -> str:
    url = local.valid_url(value)
    host = (urlparse(url).hostname or "").lower().rstrip(".")
    if not any(host == name or host.endswith("." + name) for name in SUPPORTED_HOSTS):
        raise ValueError("The online app supports public YouTube, Vimeo, TikTok, Dailymotion, and Internet Archive video links. Use the installed app for other sites.")
    return url


def cleanup_jobs() -> None:
    while True:
        time.sleep(60)
        now = time.time()
        folders = []
        with local.LOCK:
            for key, job in list(local.JOBS.items()):
                age = now - job.get("created", now)
                ttl = FILE_TTL if job.get("status") in ("ready", "error") else TOKEN_TTL
                if job.get("status") in ("queued", "downloading") or age < ttl:
                    continue
                if folder := job.get("folder"):
                    folders.append(folder)
                del local.JOBS[key]
        for folder in folders:
            shutil.rmtree(folder, ignore_errors=True)
        with REQUEST_LOCK:
            for key, history in list(REQUESTS.items()):
                while history and time.monotonic() - history[0] > 3600:
                    history.popleft()
                if not history:
                    del REQUESTS[key]


class Handler(local.Handler):
    def log_message(self, format: str, *args: object) -> None:
        # Keep request logs free of submitted URLs and download tokens.
        pass

    def allowed(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        parsed = urlparse(origin)
        return parsed.scheme in ("https", "http") and parsed.netloc.lower() == self.headers.get("Host", "").lower()

    def body(self) -> dict:
        data = super().body()
        if self.path == "/api/inspect":
            data["url"] = supported_url(data.get("url"))
        return data

    def rate_allowed(self, limit: int) -> bool:
        forwarded = self.headers.get("X-Forwarded-For", "")
        client = forwarded.split(",", 1)[0].strip() or self.client_address[0]
        key = f"{client}:{self.path}"
        now = time.monotonic()
        with REQUEST_LOCK:
            history = REQUESTS[key]
            while history and now - history[0] > 3600:
                history.popleft()
            if len(history) >= limit:
                return False
            history.append(now)
            return True

    def do_POST(self) -> None:
        if self.path == "/api/inspect" and not self.rate_allowed(24):
            self.send_json(429, {"error": "Too many requests. Try again later."})
            return
        if self.path == "/api/download":
            with local.LOCK:
                active = sum(job.get("status") in ("queued", "downloading") for job in local.JOBS.values())
            if active >= MAX_ACTIVE:
                self.send_json(503, {"error": "The online downloader is busy. Try again shortly."})
                return
            if not self.rate_allowed(8):
                self.send_json(429, {"error": "Download limit reached. Try again later."})
                return
        super().do_POST()

    def do_GET(self) -> None:
        if self.path in ("/healthz", "/api/health"):
            self.send_json(200, {"ok": True, "yt_dlp": True, "ffmpeg": local.ffmpeg_path() is not None})
            return
        # A completed file is served only through its unguessable job ID.
        if re.fullmatch(r"/api/jobs/[a-f0-9]{32}/file", self.path):
            with local.LOCK:
                job = local.JOBS.get(self.path.split("/")[3])
                if job and job.get("status") == "ready":
                    job["created"] = time.time()
        super().do_GET()


if __name__ == "__main__":
    os.environ.setdefault("VIDEO_APP_MAX_MB", "250")
    os.environ.setdefault("VIDEO_APP_MAX_SECONDS", "900")
    os.environ.setdefault("VIDEO_APP_JS_RUNTIME", "node")
    port = int(os.environ.get("PORT", "10000"))
    threading.Thread(target=cleanup_jobs, daemon=True).start()
    print(f"VideoDesk online server listening on port {port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
