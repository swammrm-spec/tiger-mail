@echo off
start /B node server\index.js
timeout /t 3 /nobreak >nul
start /B npx vite --host
echo Backend and Vite started.
echo Backend: http://localhost:3001
echo Frontend: http://localhost:5173
