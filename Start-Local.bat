@echo off
title Dental App (localhost)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed.
  echo   Install the LTS version from https://nodejs.org , then double-click this file again.
  echo.
  pause
  exit /b 1
)
if not exist ".env.local" (
  > ".env.local" echo # Settings for running the Dental App on this computer. Do NOT upload this file to GitHub.
  >> ".env.local" echo # Neon: Dashboard - your project - Connect - copy the connection string
  >> ".env.local" echo DATABASE_URL=postgresql://USER:PASSWORD@HOST.neon.tech/neondb?sslmode=require
  >> ".env.local" echo DENTIST_USERNAME=dentist
  >> ".env.local" echo DENTIST_PASSWORD=change-this-password
  echo.
  echo   First time: fill in .env.local in the Notepad window that opens, save it, close Notepad.
  echo.
  notepad ".env.local"
)
if not exist "node_modules\@neondatabase\serverless" (
  echo   Installing, one time only...
  call npm install --no-audit --no-fund
  if errorlevel 1 ( echo   npm install failed. Check your internet. & pause & exit /b 1 )
)
start "" http://localhost:3000/Students.html
node local-server.mjs
pause
