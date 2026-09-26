@echo off
REM ============================================================
REM  ogu — kliknij dwukrotnie, zeby uruchomic strone.
REM  Przy pierwszym uruchomieniu zainstaluje co trzeba,
REM  a potem samo otworzy strone w przegladarce.
REM  Tego okna nie zamykaj, dopoki korzystasz ze strony.
REM ============================================================
title ogu
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js nie jest zainstalowany na tym komputerze.
  echo.
  echo   Otworzy sie strona do pobrania. Kliknij zielony przycisk LTS,
  echo   zainstaluj, a potem kliknij START-WINDOWS jeszcze raz.
  echo.
  start "" "https://nodejs.org"
  pause
  exit /b 1
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Utworzono plik .env.
)

if not exist "node_modules" (
  echo Instaluje potrzebne biblioteki. To trwa tylko raz, okolo minuty...
  call npm install
  if errorlevel 1 (
    echo.
    echo   npm install sie nie udal. Przewin okno w gore, zeby zobaczyc blad.
    pause
    exit /b 1
  )
)

echo.
echo   Uruchamiam ogu pod adresem http://localhost:3000
echo   Zaraz otworzy sie przegladarka. Zostaw to okno otwarte.
echo.

start "" cmd /c "timeout /t 4 >nul & start http://localhost:3000"

node server.js

echo.
echo   Strona zostala zatrzymana.
echo   (Jesli powyzej widac blad, zrob zdjecie tego okna i wyslij je.)
pause
