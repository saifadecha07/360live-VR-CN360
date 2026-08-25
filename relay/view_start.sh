#!/usr/bin/env bash
# CN360Live — Viewport API launcher (Mac / Linux)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo " ================================================"
echo "  CN360Live | Viewport API (yaw/pitch/fov -> JPEG)"
echo " ================================================"
echo ""

PY=python3
command -v "$PY" &>/dev/null || PY=python
if ! command -v "$PY" &>/dev/null; then
  echo " [ERROR] ไม่พบ python3/python ใน PATH"
  echo " ติดตั้งได้ที่: https://www.python.org/downloads/"
  exit 1
fi

exec "$PY" "$SCRIPT_DIR/view_server.py"
