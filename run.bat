@echo off
setlocal

REM JARVIS AI - run from source (no install)
cd /d "%~dp0"

echo.
echo ============================================
echo   JARVIS AI - Running from source
echo ============================================
echo.

call npm start

if errorlevel 1 (
    echo.
    echo [ERROR] App exited with an error.
    pause
    exit /b 1
)

endlocal
exit /b 0