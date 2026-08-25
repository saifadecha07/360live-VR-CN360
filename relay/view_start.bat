@echo off
title CN360Live — Viewport API

echo.
echo  ================================================
echo   CN360Live ^| Viewport API (yaw/pitch/fov -> JPEG)
echo  ================================================
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] ไม่พบ python ใน PATH
    echo  ดาวน์โหลดได้ที่: https://www.python.org/downloads/
    echo.
    pause
    exit /b 1
)

python "%~dp0view_server.py"
pause
