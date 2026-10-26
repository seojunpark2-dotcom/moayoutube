@echo off
cd /d "%~dp0"
"runtime\node.exe" "scripts\register-protocol.mjs" --remove
pause
