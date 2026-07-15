@echo off
REM Double-click this to start your Aukora node (Windows).
cd /d "%~dp0.."
where bun >nul 2>nul
if errorlevel 1 (
  echo Bun is not installed yet.
  echo Install it once by running this in PowerShell:
  echo     irm bun.sh/install.ps1 ^| iex
  echo Then restart your terminal and double-click this again.
  pause
  exit /b 1
)
call bun run start
pause
