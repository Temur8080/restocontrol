#!/bin/bash
# Server'da apiRoutes xatosini tuzatish script

echo "============================================"
echo "Server'da apiRoutes Xatosi Tuzatish"
echo "============================================"
echo ""

cd /var/www/restocontrol

echo "1. Git'dan yangilash..."
git pull origin main

echo ""
echo "2. routes/api.js mavjudligini tekshirish..."
if [ ! -f "routes/api.js" ]; then
    echo "❌ routes/api.js topilmadi!"
    echo "   Git'dan to'liq yangilash kerak"
    exit 1
fi

echo "✅ routes/api.js mavjud"

echo ""
echo "3. server.js faylini tekshirish..."
# server.js faylida apiRoutes require qilinganligini tekshirish
if grep -q "const apiRoutes = require('./routes/api');" server.js; then
    echo "✅ apiRoutes to'g'ri require qilingan"
else
    echo "⚠️  apiRoutes require qilinmagan yoki noto'g'ri"
    echo "   server.js faylini qo'lda tuzatish kerak"
fi

echo ""
echo "4. PM2 qayta ishga tushirish..."
pm2 restart restocontrol --update-env

echo ""
echo "5. Log'larni tekshirish..."
sleep 2
pm2 logs restocontrol --lines 20 --nostream

echo ""
echo "============================================"
echo "✅ Tuzatish bajarildi!"
echo "============================================"
