@echo off
cd /d "%~dp0"
echo Starting Creative Studio...
start "" cmd /c "timeout /t 1 /nobreak >nul && start http://127.0.0.1:8765/"
python -m http.server 8765
