@echo off
REM Git'ga Loyihani Joylash - Windows Script
REM Bu script Git repository yaratishni soddalashtiradi

echo ========================================
echo Git Repository Yaratish va GitHub'ga Yuklash
echo ========================================
echo.

REM Check if Git is installed
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [X] Git o'rnatilmagan!
    echo [*] Git o'rnatish: https://git-scm.com/download/win
    pause
    exit /b 1
)

echo [OK] Git topildi
echo.

REM Check if already a git repository
if exist .git (
    echo [*] Git repository allaqachon mavjud
    git status
    echo.
    echo [*] Keyingi qadamlar:
    echo    1. git add .
    echo    2. git commit -m "Commit message"
    echo    3. git remote add origin https://github.com/username/repo.git
    echo    4. git push -u origin main
    pause
    exit /b 0
)

echo [*] Git repository yaratilmoqda...
git init

if %errorlevel% neq 0 (
    echo [X] Git repository yaratishda xatolik!
    pause
    exit /b 1
)

echo [OK] Git repository yaratildi
echo.

echo [*] Barcha fayllar qo'shilmoqda...
git add .

echo.
set /p COMMIT_MSG="Commit xabari (Initial commit): "
if "%COMMIT_MSG%"=="" set COMMIT_MSG=Initial commit - Hodim Nazorati loyihasi

git commit -m "%COMMIT_MSG%"

if %errorlevel% neq 0 (
    echo [X] Commit qilishda xatolik!
    pause
    exit /b 1
)

echo.
echo [OK] Commit qilindi
echo.

echo ========================================
echo Keyingi Qadamlar:
echo ========================================
echo.
echo 1. GitHub'da repository yarating:
echo    - https://github.com/new ga kiring
echo    - Repository nomini kiriting
echo    - "Create repository" tugmasini bosing
echo.
echo 2. Remote repository qo'shing:
echo    git remote add origin https://github.com/USERNAME/REPO.git
echo.
echo 3. Branch nomini main qiling:
echo    git branch -M main
echo.
echo 4. GitHub'ga yuklang:
echo    git push -u origin main
echo.
echo ========================================
echo [OK] Git repository tayyor!
echo ========================================
pause
