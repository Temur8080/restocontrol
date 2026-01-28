#!/bin/bash

# Server'da loyihani Git'dan yuklab olish va yangilash skripti
# Repo: https://github.com/Temur8080/restocontrol.git

set -e

echo "============================================"
echo "Loyihani Git'dan Yuklab Olish"
echo "============================================"
echo ""

DEPLOY_DIR="/var/www/restocontrol"
REPO_URL="https://github.com/Temur8080/restocontrol.git"
PM2_APP_NAME="hodim-nazorati"  # ecosystem.config.js dagi nom bilan bir xil

echo "1. Loyiha papkasini tekshirish..."
if [ ! -d "$DEPLOY_DIR" ]; then
    echo "📁 Papka mavjud emas, yaratilmoqda: $DEPLOY_DIR"
    mkdir -p "$DEPLOY_DIR"
fi

cd "$DEPLOY_DIR"

echo ""
echo "2. Git holatini tekshirish..."
if [ -d ".git" ]; then
    echo "🔄 Mavjud Git repo topildi, yangilanmoqda..."
    git fetch origin
    
    # Divergent branches holatini hal qilish
    echo "📋 Serverdagi o'zgarishlarni tekshirish..."
    LOCAL_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "")
    REMOTE_COMMIT=$(git rev-parse origin/main 2>/dev/null || echo "")
    
    if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ] && [ -n "$LOCAL_COMMIT" ] && [ -n "$REMOTE_COMMIT" ]; then
        echo "⚠️  Server va GitHub'dagi kodlar farq qilmoqda"
        echo "🔄 GitHub'dagi versiyani asosiy qilib qabul qilmoqda..."
        git reset --hard origin/main
    else
        echo "✅ Git holati yangilanmoqda..."
        git pull origin main --no-rebase || git reset --hard origin/main
    fi
else
    echo "📥 Git repo topilmadi, yangidan yuklanmoqda..."
    git clone "$REPO_URL" .
fi

echo ""
echo "3. Dependencies o'rnatish..."
npm install --production

echo ""
echo "4. Fayllarni tekshirish..."
if [ -f "server.js" ]; then
    echo "✅ server.js mavjud"
else
    echo "❌ server.js topilmadi!"
    exit 1
fi

if [ -f "routes/api.js" ]; then
    echo "✅ routes/api.js mavjud"
else
    echo "❌ routes/api.js topilmadi!"
    exit 1
fi

echo ""
echo "5. PM2 qayta ishga tushirish..."
if command -v pm2 &> /dev/null; then
    if pm2 list | grep -q "$PM2_APP_NAME"; then
        echo "🔄 Mavjud PM2 process qayta ishga tushirilmoqda: $PM2_APP_NAME"
        pm2 restart "$PM2_APP_NAME" --update-env
    else
        echo "🆕 PM2 process topilmadi, ecosystem.config.js orqali ishga tushirilmoqda..."
        pm2 start ecosystem.config.js
    fi
else
    echo "⚠️  PM2 topilmadi. O'rnatish uchun: npm install -g pm2"
    echo "ℹ️  Hozir server avtomatik qayta ishga tushirilmaydi."
fi

echo ""
echo "6. Log'larni tekshirish (3 soniya kutib)..."
sleep 3
if command -v pm2 &> /dev/null; then
    pm2 logs "$PM2_APP_NAME" --lines 20 --nostream
fi

echo ""
echo "============================================"
echo "✅ Yuklab olish muvaffaqiyatli!"
echo "============================================"
echo ""

