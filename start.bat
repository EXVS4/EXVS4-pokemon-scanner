@echo off
chcp 65001 > nul
title Card Price Scanner

echo.
echo  ==========================================
echo   Card Price Scanner - 起動中...
echo  ==========================================
echo.

REM ── 方法1: PowerShell (Windows標準、追加インストール不要) ──
echo  PowerShell でサーバーを起動します...
echo  ブラウザで http://localhost:8080 を開いてください
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0start_server.ps1"
if %errorlevel% equ 0 goto :eof

REM ── 方法2: Node.js ──
where node >nul 2>&1
if %errorlevel% equ 0 (
    echo  Node.js でサーバーを起動します...
    start "" "http://localhost:8080"
    node "%~dp0server.js"
    goto :eof
)

REM ── 方法3: Python 3 ──
where python >nul 2>&1
if %errorlevel% equ 0 (
    echo  Python でサーバーを起動します...
    start "" "http://localhost:8080"
    cd /d "%~dp0"
    python -m http.server 8080
    goto :eof
)

where py >nul 2>&1
if %errorlevel% equ 0 (
    echo  Python でサーバーを起動します...
    start "" "http://localhost:8080"
    cd /d "%~dp0"
    py -m http.server 8080
    goto :eof
)

echo  [エラー] サーバーを起動できませんでした。
echo  PowerShell, Node.js, Python のいずれかが必要です。
echo.
pause

