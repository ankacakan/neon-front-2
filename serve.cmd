@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js bulunamadi.
  echo   Lutfen https://nodejs.org adresinden Node 18+ kurun.
  echo.
  pause
  exit /b 1
)

node "%~dp0tools\serve.mjs" %*
