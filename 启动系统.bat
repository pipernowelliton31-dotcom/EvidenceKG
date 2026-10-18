@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
"%~dp0system\runtime\python.exe" -I -B -X utf8 "%~dp0system\tools\portable_start.py"
if errorlevel 1 pause
