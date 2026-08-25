#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# CN360Live — Local Relay Launcher (Mac / Linux)
# รัน MediaMTX + ngrok แล้วแสดง URL ให้คัดลอกได้ทันที
# ─────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/mediamtx.yml"

echo ""
echo " ================================================"
echo "  CN360Live | Local Relay Launcher"
echo "  MediaMTX + ngrok | Insta360 X5"
echo " ================================================"
echo ""

# ── ตรวจสอบ dependencies ─────────────────────────────────────
check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo " [ERROR] ไม่พบ '$1' ใน PATH"
    echo " $2"
    echo ""
    exit 1
  fi
}

check_cmd mediamtx \
  "ดาวน์โหลด: https://github.com/bluenviron/mediamtx/releases/latest"
check_cmd ngrok \
  "ดาวน์โหลด: https://ngrok.com/download  แล้วรัน: ngrok config add-authtoken YOUR_TOKEN"
check_cmd curl \
  "ติดตั้ง curl ก่อน"

# ── cleanup เมื่อออก ──────────────────────────────────────────
cleanup() {
  echo ""
  echo " Stopping all processes..."
  kill "$MTX_PID"  2>/dev/null || true
  kill "$NGROK_TCP_PID" 2>/dev/null || true
  kill "$NGROK_HLS_PID" 2>/dev/null || true
  kill "${VIEW_PID:-}" 2>/dev/null || true
  echo " Done."
}
trap cleanup EXIT INT TERM

# ── รัน MediaMTX ─────────────────────────────────────────────
echo " [1/4] Starting MediaMTX..."
mediamtx "$CONFIG" &
MTX_PID=$!
sleep 1

# ── รัน ngrok TCP tunnel (RTMP :1935) ────────────────────────
echo " [2/4] Starting ngrok RTMP tunnel (port 1935)..."
ngrok tcp 1935 --log=stdout --log-format=json > /tmp/ngrok_rtmp.log 2>&1 &
NGROK_TCP_PID=$!

# ── รัน ngrok HTTP tunnel (HLS :8888) ────────────────────────
# หมายเหตุ: ngrok free plan รัน 1 session (= 1 agent process)
#            2 tunnels ใน session เดียวต้องใช้ ngrok config file
#            ดู README สำหรับวิธีตั้งค่า ngrok.yml
echo " [2/4] Starting ngrok HLS tunnel (port 8888)..."
ngrok http 8888 --log=stdout --log-format=json > /tmp/ngrok_hls.log 2>&1 &
NGROK_HLS_PID=$!

# ── รัน Viewport API (yaw/pitch/fov -> JPEG, ต้องมี python3) ──
PY=python3
command -v "$PY" &>/dev/null || PY=python
if command -v "$PY" &>/dev/null; then
  echo " [3/4] Starting Viewport API (port 8095)..."
  "$PY" "$SCRIPT_DIR/view_server.py" &
  VIEW_PID=$!
else
  echo " [3/4] ข้าม Viewport API — ไม่พบ python3/python ใน PATH"
fi

# ── รอให้ ngrok initialize ───────────────────────────────────
echo " [4/4] Waiting for ngrok to initialize..."
sleep 4

# ── ดึง URL จาก ngrok local API ──────────────────────────────
echo ""
echo " ================================================"
echo "  STREAM ENDPOINTS"
echo " ================================================"
echo ""

TUNNEL_JSON=$(curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null || echo "")

if [ -z "$TUNNEL_JSON" ]; then
  echo " [WARN] ไม่สามารถดึง URL จาก ngrok API ได้"
  echo " เปิด http://127.0.0.1:4040 ใน browser เพื่อดู URL"
else
  # parse ด้วย python3 (มีบน Mac/Linux ส่วนใหญ่) หรือ node
  if command -v python3 &>/dev/null; then
    python3 - <<'EOF'
import json, sys, urllib.request
try:
    data = json.loads(urllib.request.urlopen("http://127.0.0.1:4040/api/tunnels").read())
    for t in data.get("tunnels", []):
        print(f"  [{t['proto']}]  {t['public_url']}  ->  {t['config']['addr']}")
except Exception as e:
    print(f"  [WARN] {e}")
EOF
  else
    echo " $TUNNEL_JSON" | grep -o '"public_url":"[^"]*"' | sed 's/"public_url":"//;s/"//'
  fi
fi

echo ""
echo " ── ขั้นตอนถัดไป ─────────────────────────────────"
echo ""
echo " 1. เปิดแอป Insta360 บนมือถือ"
echo "    Live > Custom RTMP > ใส่ URL:"
echo "    rtmp://<ngrok-tcp-host>:<port>/live/x5"
echo "    เช่น:  rtmp://0.tcp.ngrok.io:12345/live/x5"
echo ""
echo " 2. เปิด CN360Live แล้วกด LIVE CAM"
echo "    ใส่ HLS URL:"
echo "    http://<ngrok-http-url>/live/x5/index.m3u8"
echo ""
echo " 3. กด CONNECT — รอสักครู่จนสตรีมขึ้น"
echo ""
echo " 4. ทดสอบ Viewport API (ตัดภาพตามมุม yaw/pitch):"
echo "    http://localhost:8095/api/view?yaw=0&pitch=0&fov=90&mode=360"
echo "    เปิด public/view-test.html เพื่อทดลองผ่านหน้าเว็บ"
echo ""
echo " ================================================"
echo "  หมายเหตุ: URL จะเปลี่ยนทุกครั้งที่รีสตาร์ท ngrok"
echo "  เครื่องนี้ต้องเปิดค้างตลอดช่วงที่สตรีม"
echo " ================================================"
echo ""
echo " กด Ctrl+C เพื่อหยุดทุกอย่าง"
echo ""

# ── รอจนกว่าจะ Ctrl+C ────────────────────────────────────────
wait
