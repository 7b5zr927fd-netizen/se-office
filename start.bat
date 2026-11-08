@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Потрібен Node.js. Встановіть його ^(кнопка LTS^) і запустіть цей файл ще раз.
  start https://nodejs.org
  pause
  exit /b
)
node server.js
pause
