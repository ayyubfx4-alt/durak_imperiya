@echo off
:: Set PATH to include local Node.js
set PATH=C:\Users\User\AppData\Local\nodejs\node-v20.18.0-win-x64;%PATH%

echo Starting Durak Imperia local servers...

:: Start Backend
start "Durak Backend (:4000)" cmd /k "cd backend && npm run dev"

:: Start Admin Panel
start "Durak Admin Panel (:8081)" cmd /k "cd admin-panel && npm run dev"

:: Start Web Client
start "Durak Web Client (:8080)" cmd /k "cd web-client && npm run dev"

echo All servers triggered. Check the opened cmd windows for logs.
pause
