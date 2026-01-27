#!/bin/bash
# Server'da loyihani Git'dan yuklab olish

echo "============================================"
echo "Loyihani Git'dan Yuklab Olish"
echo "============================================"
echo ""

# Loyiha papkasiga o'tish
cd /var/www/restocontrol

echo "1. Joriy holatni tekshirish..."
git status

echo ""
echo "2. Git'dan yangilash..."
git fetch origin
git pull origin main

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
pm2 restart restocontrol --update-env

echo ""
echo "6. Log'larni tekshirish (3 soniya kutib)..."
sleep 3
pm2 logs restocontrol --lines 20 --nostream

echo ""
echo "============================================"
echo "✅ Yuklab olish muvaffaqiyatli!"
echo "============================================"
