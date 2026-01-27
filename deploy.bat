@echo off
REM Deployment Script for Hodim Nazorati (Windows)
REM Bu script serverga deploy qilishni soddalashtiradi

echo ==================================
echo Hodim Nazorati Deployment Script
echo ==================================
echo.

REM Check if .env file exists
if not exist .env (
    echo [X] .env fayl topilmadi!
    echo [*] .env.example faylidan nusxa oling va ma'lumotlarni to'ldiring:
    echo    copy .env.example .env
    echo    notepad .env
    pause
    exit /b 1
)

echo [OK] .env fayl topildi
echo.

REM Install dependencies
echo [*] Dependencies o'rnatilmoqda...
call npm install --production

if %errorlevel% neq 0 (
    echo [X] Dependencies o'rnatishda xatolik!
    pause
    exit /b 1
)

echo.
echo [OK] Dependencies o'rnatildi
echo.

REM Ask about migrations
set /p RUN_MIGRATIONS="Database migration'larni ishga tushirish kerakmi? (y/n): "
if /i "%RUN_MIGRATIONS%"=="y" (
    echo [*] Migration'lar ishga tushirilmoqda...
    call npm run migrate
    echo [OK] Migration'lar bajarildi
    echo.
)

echo [*] Server ishga tushirish uchun buyruqlar:
echo.
echo PM2 orqali:
echo   pm2 start ecosystem.config.js
echo   pm2 save
echo.
echo Yoki oddiy Node.js:
echo   npm start
echo.
echo ==================================
echo [OK] Deployment tayyor!
echo ==================================
pause
