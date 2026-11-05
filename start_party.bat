@echo off
rem NomadTactics - start the party server (double-click). Optional: start_party.bat --port 8081 --max 4
title NomadTactics Party-Server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js fehlt. Einmal installieren: https://nodejs.org  ^(LTS^)
  echo   oder in der Eingabeaufforderung:  winget install OpenJS.NodeJS.LTS
  echo.
  pause
  exit /b 1
)
node tools\party\server.js --open %*
echo.
echo   Server beendet.
pause
