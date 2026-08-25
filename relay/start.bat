@echo off
setlocal EnableDelayedExpansion
title CN360Live — Local Relay

echo.
echo  ================================================
echo   CN360Live ^| Local Relay Launcher
echo   MediaMTX + ngrok ^| Insta360 X5
echo  ================================================
echo.

:: ── ตรวจสอบ mediamtx ────────────────────────────────────────
where mediamtx >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] ไม่พบ mediamtx.exe ใน PATH
    echo.
    echo  ดาวน์โหลดได้ที่:
    echo  https://github.com/bluenviron/mediamtx/releases/latest
    echo  แตกไฟล์ แล้ว copy mediamtx.exe ไปไว้ใน folder นี้ หรือเพิ่มใน PATH
    echo.
    pause
    exit /b 1
)

:: ── ตรวจสอบ ngrok ────────────────────────────────────────────
where ngrok >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] ไม่พบ ngrok ใน PATH
    echo.
    echo  ดาวน์โหลดได้ที่: https://ngrok.com/download
    echo  แตกไฟล์ แล้ว copy ngrok.exe ไปไว้ใน folder นี้ หรือเพิ่มใน PATH
    echo  จากนั้นรัน: ngrok config add-authtoken YOUR_TOKEN
    echo.
    pause
    exit /b 1
)

:: ── รัน MediaMTX ─────────────────────────────────────────────
echo  [1/4] Starting MediaMTX...
start "MediaMTX" /min mediamtx "%~dp0mediamtx.yml"
timeout /t 2 /nobreak >nul

:: ── รัน ngrok TCP tunnel สำหรับ RTMP (port 1935) ─────────────
echo  [2/4] Starting ngrok RTMP tunnel (port 1935)...
start "ngrok-rtmp" /min ngrok tcp 1935 --log=stdout --log-format=json

:: ── รัน ngrok HTTP tunnel สำหรับ HLS/WebRTC (port 8888) ──────
:: หมายเหตุ: ngrok free plan รัน tunnel พร้อมกัน 1 session
::            ถ้าต้องการทั้ง RTMP และ HLS ต้องใช้ ngrok config file
::            หรืออัปเกรด plan — ดู README สำหรับรายละเอียด
echo  [2/4] Starting ngrok HLS tunnel (port 8888)...
start "ngrok-hls" /min ngrok http 8888 --log=stdout --log-format=json

:: ── รัน Viewport API (yaw/pitch/fov -> JPEG, ต้องมี python) ──
where python >nul 2>&1
if not errorlevel 1 (
    echo  [3/4] Starting Viewport API (port 8095)...
    start "ViewportAPI" /min python "%~dp0view_server.py"
) else (
    echo  [3/4] ข้าม Viewport API — ไม่พบ python ใน PATH
)

:: ── รอให้ ngrok เริ่มทำงาน ───────────────────────────────────
echo  [4/4] Waiting for ngrok to initialize...
timeout /t 4 /nobreak >nul

:: ── ดึง URL จาก ngrok API ─────────────────────────────────────
echo.
echo  ================================================
echo   STREAM ENDPOINTS
echo  ================================================
echo.

:: ngrok local API อยู่ที่ http://127.0.0.1:4040/api/tunnels
curl -s http://127.0.0.1:4040/api/tunnels > "%TEMP%\ngrok_tunnels.json" 2>nul

if errorlevel 1 (
    echo  [WARN] ไม่สามารถดึง URL จาก ngrok API ได้
    echo  เปิด http://127.0.0.1:4040 ใน browser เพื่อดู URL
) else (
    :: ใช้ PowerShell parse JSON
    powershell -NoProfile -Command ^
        "$t = Get-Content '%TEMP%\ngrok_tunnels.json' | ConvertFrom-Json;" ^
        "$t.tunnels | ForEach-Object {" ^
        "  $proto = $_.proto;" ^
        "  $pub = $_.public_url;" ^
        "  $local = $_.config.addr;" ^
        "  Write-Host \"  [$proto] $pub  ->  $local\"" ^
        "}"
)

echo.
echo  ── ขั้นตอนถัดไป ────────────────────────────────
echo.
echo  1. เปิดแอป Insta360 บนมือถือ
echo     Live ^> Custom RTMP ^> ใส่ URL:
echo     tcp://  ^<ngrok-tcp-url^>  (port ที่ ngrok กำหนด)
echo     เช่น:  rtmp://0.tcp.ngrok.io:12345/live/x5
echo.
echo  2. เปิด CN360Live แล้วกด LIVE CAM
echo     ใส่ HLS URL:
echo     http://^<ngrok-http-url^>/live/x5/index.m3u8
echo.
echo  3. กด CONNECT — รอสักครู่จนสตรีมขึ้น
echo.
echo  4. ทดสอบ Viewport API (ตัดภาพตามมุม yaw/pitch):
echo     http://localhost:8095/api/view?yaw=0^&pitch=0^&fov=90^&mode=360
echo     เปิด public/view-test.html เพื่อทดลองผ่านหน้าเว็บ
echo.
echo  ================================================
echo   หมายเหตุ: URL จะเปลี่ยนทุกครั้งที่รีสตาร์ท ngrok
echo   เครื่องนี้ต้องเปิดค้างตลอดช่วงที่สตรีม
echo  ================================================
echo.
echo  กด Ctrl+C หรือปิดหน้าต่างนี้เพื่อหยุดทุกอย่าง
echo.
pause
