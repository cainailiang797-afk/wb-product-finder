@echo off
cd /d "%~dp0"
title WB start (Chrome 9222 + list server 8901)

echo [1/2] Starting WB debug Chrome on port 9222 ...
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=C:\wb-debug-profile --no-first-run --no-default-browser-check https://www.wildberries.ru

echo [2/2] Starting local list server on port 8901 ...
netstat -ano | findstr /R /C:"LISTENING.*:8901" >nul
if errorlevel 1 (
  start "" /min node "scripts\server.js"
) else (
  echo     8901 already running, skipped
)

ping -n 4 127.0.0.1 >nul
start "" "http://localhost:8901/"
echo Done: Chrome 9222 + http://localhost:8901/
ping -n 3 127.0.0.1 >nul
