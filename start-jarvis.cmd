@echo off
title JARVIS
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Install the LTS version from https://nodejs.org
  echo  then double-click this file again.
  echo.
  pause
  exit /b 1
)
if not exist ".env" (
  if exist ".env.txt" (
    ren ".env.txt" ".env"
    echo  Renamed .env.txt to .env
  ) else (
    copy ".env.example" ".env" >nul
    echo.
    echo  Created your settings file ".env". Notepad will open it now:
    echo  add your GROQ_API_KEY, save, close Notepad, and JARVIS will start.
    echo.
    notepad ".env"
  )
)
echo  Starting JARVIS... your browser will open in a few seconds.
start "" cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:3000"
node --disable-warning=ExperimentalWarning server\start.js
echo.
echo  JARVIS stopped.
pause
