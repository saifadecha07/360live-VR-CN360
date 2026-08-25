#!/usr/bin/env python3
"""
CN360Live · Viewport API

Turns the live 360 stream (pulled from the local MediaMTX relay over RTSP)
into an on-demand 2D snapshot for a requested viewing angle, using ffmpeg's
v360 filter to reproject the equirectangular frame.

Endpoints:
  GET /api/view?yaw=&pitch=&fov=&mode=360|180&w=&h=&path=
      -> image/jpeg crop of the live stream at the requested angle
  GET /api/view/status
      -> {"relay": "up"|"down"} quick check of the MediaMTX RTSP port

Requires only the Python 3 standard library + relay/ffmpeg.exe (bundled).
"""

import json
import os
import socket
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.path.join(SCRIPT_DIR, "ffmpeg.exe")

RTSP_HOST = "127.0.0.1"
RTSP_PORT = 8554
DEFAULT_PATH = "live/x5"

VIEW_PORT = int(os.environ.get("VIEW_PORT", "8095"))


def clamp(value, lo, hi):
    return max(lo, min(hi, value))


def wrap180(value):
    return ((value + 180) % 360) - 180


def parse_float(qs, key, default):
    try:
        return float(qs[key][0])
    except (KeyError, ValueError, IndexError):
        return default


def safe_path(qs):
    raw = qs.get("path", [DEFAULT_PATH])[0]
    # RTSP path segment only — no scheme, host, query or traversal.
    raw = raw.strip().lstrip("/")
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/_-")
    if not raw or any(c not in allowed for c in raw) or ".." in raw:
        return DEFAULT_PATH
    return raw


def build_filter(mode, yaw, pitch, fov, w, h):
    if mode == "180":
        return f"v360=input=e:output=fisheye:yaw={yaw}:pitch={pitch}:roll=0:d_fov=180:w={w}:h={h}"
    return f"v360=input=e:output=flat:yaw={yaw}:pitch={pitch}:roll=0:d_fov={fov}:w={w}:h={h}"


def tcp_up(host, port, timeout=1.5):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


class Handler(BaseHTTPRequestHandler):
    server_version = "CN360ViewServer/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("[view-server] " + (fmt % args) + "\n")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")

    def _json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)

        if parsed.path == "/api/view/status":
            up = tcp_up(RTSP_HOST, RTSP_PORT)
            self._json(200, {"relay": "up" if up else "down"})
            return

        if parsed.path == "/api/view":
            self._handle_view(qs)
            return

        self._json(404, {"error": "not found"})

    def _handle_view(self, qs):
        mode = qs.get("mode", ["360"])[0]
        mode = "180" if mode == "180" else "360"

        yaw = wrap180(parse_float(qs, "yaw", 0.0))
        pitch = clamp(parse_float(qs, "pitch", 0.0), -90.0, 90.0)
        fov = clamp(parse_float(qs, "fov", 90.0), 30.0, 120.0)
        w = int(clamp(parse_float(qs, "w", 1280), 128, 3840))
        h = int(clamp(parse_float(qs, "h", 720), 128, 2160))
        path = safe_path(qs)

        rtsp_url = f"rtsp://{RTSP_HOST}:{RTSP_PORT}/{path}"
        vf = build_filter(mode, yaw, pitch, fov, w, h)

        cmd = [
            FFMPEG, "-hide_banner", "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-timeout", "3000000",
            "-i", rtsp_url,
            "-frames:v", "1",
            "-vf", vf,
            "-f", "image2", "-q:v", "3",
            "pipe:1",
        ]

        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=15)
        except subprocess.TimeoutExpired:
            self._json(503, {"error": "timeout reading stream", "path": path})
            return
        except FileNotFoundError:
            self._json(500, {"error": "ffmpeg.exe not found next to view_server.py"})
            return

        if proc.returncode != 0 or not proc.stdout:
            self._json(503, {
                "error": "stream unavailable",
                "path": path,
                "hint": "is the relay running and is the camera publishing to this path?",
                "ffmpeg_stderr": proc.stderr.decode("utf-8", "ignore")[-500:],
            })
            return

        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(proc.stdout)))
        self.send_header("X-View-Mode", mode)
        self.send_header("X-View-Yaw", str(yaw))
        self.send_header("X-View-Pitch", str(pitch))
        self.end_headers()
        self.wfile.write(proc.stdout)


def main():
    if not os.path.isfile(FFMPEG):
        print(f"[view-server] ERROR: ffmpeg.exe not found at {FFMPEG}", file=sys.stderr)
        sys.exit(1)

    server = ThreadingHTTPServer(("0.0.0.0", VIEW_PORT), Handler)
    print(f"[view-server] CN360Live Viewport API listening on http://0.0.0.0:{VIEW_PORT}")
    print(f"[view-server] pulling from rtsp://{RTSP_HOST}:{RTSP_PORT}/{DEFAULT_PATH} by default")
    print(f"[view-server] try: http://localhost:{VIEW_PORT}/api/view?yaw=0&pitch=0&fov=90&mode=360")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
