@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo ============================================
    echo  Primeira vez rodando - preparando o ambiente
    echo  (isso demora um pouco so nesta primeira vez)
    echo ============================================
    python -m venv .venv
    ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    echo.
    echo Ambiente pronto.
    echo.
)

echo ============================================
echo   GEEKKO ASSET FETCHER
echo ============================================
echo.
set /p pasta="Cole o caminho da pasta do video (ex: C:\...\GEEKKO_012_tema): "

".venv\Scripts\python.exe" main.py "%pasta%"

echo.
pause
