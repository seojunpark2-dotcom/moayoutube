@echo off
cd /d "%~dp0"
"runtime\node.exe" "scripts\local-start.mjs"
if errorlevel 1 pause
