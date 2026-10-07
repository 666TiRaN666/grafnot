@echo off
chcp 65001 >nul
title Grafnot
cd /d "%~dp0"
if not exist "node_modules" (
  echo Installing dependencies, please wait...
  call npm install
)
echo Starting Grafnot at http://localhost:5173 ...
start "" "http://localhost:5173"
call npm run dev
