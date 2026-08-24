@echo off
echo =============================
echo   CN360live - Git Deploy
echo =============================

set /p msg=Enter commit message: 

git add .
git commit -m "%msg%"
git push origin main

echo.
echo Deploy complete!
pause
