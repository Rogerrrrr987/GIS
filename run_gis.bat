@echo off
title GeoCanvas GIS Tool
echo Starting GeoCanvas GIS Tool...
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run_gis.ps1"
if errorlevel 1 (
  echo.
  echo Startup failed. Verify that Windows PowerShell is available.
  pause
)
