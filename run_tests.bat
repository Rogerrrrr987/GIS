@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_tests.ps1"
set "TEST_EXIT=%ERRORLEVEL%"
if not "%TEST_EXIT%"=="0" pause
exit /b %TEST_EXIT%

