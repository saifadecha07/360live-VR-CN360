@echo off
setlocal EnableDelayedExpansion
title CN360Live — Insta360 X5 USB Stream

echo.
echo  ================================================
echo   CN360Live ^| USB Camera Stream
echo   Insta360 X5 via USB-C Webcam Mode
echo  ================================================
echo.

:: ── ตรวจสอบ FFmpeg ─────────────────────────────────────
if not exist "%~dp0ffmpeg.exe" (
    echo  [ERROR] ไม่พบ ffmpeg.exe ใน relay\
    pause & exit /b 1
)

:: ── ตรวจสอบ MediaMTX ────────────────────────────────────
curl -s http://127.0.0.1:9997/v3/paths/list >nul 2>&1
if errorlevel 1 (
    echo  [WARN] MediaMTX ไม่ตอบสนอง — กำลังเริ่ม...
    start "MediaMTX" /min "%~dp0mediamtx.exe" "%~dp0mediamtx.yml"
    timeout /t 3 /nobreak >nul
)

:: ── แสดง devices ─────────────────────────────────────────
echo  กำลังค้นหากล้อง...
echo.
"%~dp0ffmpeg.exe" -list_devices true -f dshow -i dummy 2>&1 | findstr /i "video"
echo.

:: ── เลือก device ─────────────────────────────────────────
echo  ================================================
echo   เลือกกล้องที่จะใช้:
echo.
echo   1. Insta360 X5  (USB Webcam Mode)
echo   2. หน้าจอ / กล้อง อื่น ๆ (ใส่ชื่อเอง)
echo  ================================================
echo.
set /p CHOICE="เลือก (1/2): "

if "%CHOICE%"=="1" (
    set CAM_NAME=Insta360 X5
) else (
    set /p CAM_NAME="ใส่ชื่อ device (ตามที่เห็นด้านบน): "
)

:: ── เลือก resolution ─────────────────────────────────────
echo.
echo  เลือก resolution:
echo   1. 2880x1440  (360 full res — ต้องการ CPU สูง)
echo   2. 1920x960   (360 medium — แนะนำ)
echo   3. 1440x720   (360 compact — CPU ต่ำ)
echo.
set /p RES="เลือก (1/2/3) [default=2]: "

if "%RES%"=="1" ( set W=2880 & set H=1440 )
if "%RES%"=="3" ( set W=1440 & set H=720  )
if not defined W  ( set W=1920 & set H=960 )

:: ── เลือก stream path ────────────────────────────────────
echo.
set /p STREAM_PATH="Stream path [default: live/x5]: "
if "%STREAM_PATH%"=="" set STREAM_PATH=live/x5

echo.
echo  ================================================
echo   กำลัง stream:
echo     Device : %CAM_NAME%
echo     Res    : %W%x%H% @ 30fps
echo     Output : rtmp://127.0.0.1:1935/%STREAM_PATH%
echo  ================================================
echo.
echo  กด Ctrl+C เพื่อหยุด
echo.

:: ── เริ่ม stream ─────────────────────────────────────────
"%~dp0ffmpeg.exe" ^
    -f dshow ^
    -video_size %W%x%H% ^
    -framerate 30 ^
    -vcodec mjpeg ^
    -i video="%CAM_NAME%" ^
    -c:v libx264 ^
    -preset ultrafast ^
    -tune zerolatency ^
    -pix_fmt yuv420p ^
    -b:v 4000k ^
    -maxrate 4000k ^
    -bufsize 8000k ^
    -g 60 ^
    -f flv ^
    rtmp://127.0.0.1:1935/%STREAM_PATH%

echo.
echo  [INFO] Stream หยุดแล้ว
pause
