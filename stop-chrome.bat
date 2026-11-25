@echo off
title WB stop (Chrome 9222 + list server 8901)

echo Stopping WB debug Chrome and local list server ...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\wb-stop.ps1"

echo Done. Ozon Chrome on port 9223 is not affected.
ping -n 3 127.0.0.1 >nul
