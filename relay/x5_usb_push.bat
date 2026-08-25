@echo off
title CN360Live — Insta360 X5 USB -> Relay

echo.
echo  ================================================
echo   Insta360 X5 (USB Webcam Mode) -^> local relay
echo  ================================================
echo.
echo  ต้องเสียบกล้อง X5 ผ่าน USB-C และเลือก "Webcam Mode" ที่กล้องแล้ว
echo  ต้องรัน relay/start.bat (หรือ mediamtx.exe) ไว้ก่อนแล้วด้วย
echo.
echo  กด Ctrl+C เพื่อหยุด
echo.

"%~dp0ffmpeg.exe" -f dshow -video_size 2880x1440 -framerate 30 -vcodec mjpeg -i video="Insta360 X5" -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -g 60 -f flv rtmp://127.0.0.1:1935/live/x5

pause
