#!/bin/bash

# Serverga Deploy Qilish Script
# Server IP: 138.249.7.234

set -e

echo "============================================"
echo "Hodim Nazorati - Serverga Deploy"
echo "============================================"
echo ""

# 1. Loyiha papkasiga o'tish
DEPLOY_DIR="/var/www/restocontrol"
echo "📁 Loyiha papkasiga o'tilmoqda: $DEPLOY_DIR"

if [ ! -d "$DEPLOY_DIR" ]; then
    echo "📁 Papka mavjud emas, yaratilmoqda..."
    mkdir -p $DEPLOY_DIR
fi

cd $DEPLOY_DIR

# 2. Git orqali yuklash/yangilash
if [ -d ".git" ]; then
    echo "🔄 Git repository mavjud, yangilanmoqda..."
    git pull origin main
else
    echo "📥 Git orqali loyiha yuklanmoqda..."
    git clone https://github.com/Temur8080/restocontrol.git .
fi

# 3. Dependencies o'rnatish
echo "📦 Dependencies o'rnatilmoqda..."
npm install --production

# 4. .env faylini tekshirish
if [ ! -f ".env" ]; then
    echo "⚠️  .env fayl topilmadi!"
    echo "📝 .env faylini yarating va sozlang"
    echo ""
    echo "Namuna .env fayl:"
    echo "DB_HOST=localhost"
    echo "DB_PORT=5432"
    echo "DB_NAME=hodim_nazorati"
    echo "DB_USER=postgres"
    echo "DB_PASSWORD=your_password"
    echo "PORT=3000"
    echo "NODE_ENV=production"
    echo "SESSION_SECRET=random_secret_key"
    echo ""
    read -p "Davom etishni xohlaysizmi? (y/n): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# 5. Migration'lar (ixtiyoriy)
read -p "Database migration'larni ishga tushirish kerakmi? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🔄 Migration'lar ishga tushirilmoqda..."
    npm run migrate
fi

# 6. PM2 bilan ishga tushirish
echo "🚀 Server ishga tushirilmoqda..."

if command -v pm2 &> /dev/null; then
    echo "✅ PM2 topildi, PM2 bilan ishga tushirilmoqda..."
    
    # PM2'da mavjud bo'lsa, qayta ishga tushirish
    if pm2 list | grep -q "hodim-nazorati"; then
        echo "🔄 Mavjud PM2 process qayta ishga tushirilmoqda..."
        pm2 restart hodim-nazorati
    else
        echo "🆕 Yangi PM2 process yaratilmoqda..."
        pm2 start ecosystem.config.js
    fi
    
    pm2 save
    echo ""
    echo "✅ Server PM2 bilan ishga tushirildi!"
    echo ""
    echo "📊 Server holati:"
    pm2 status
else
    echo "⚠️  PM2 topilmadi, oddiy node bilan ishga tushirilmoqda..."
    echo "📝 PM2 o'rnatish: npm install -g pm2"
    NODE_ENV=production node server.js
fi

echo ""
echo "============================================"
echo "✅ Deploy muvaffaqiyatli!"
echo "============================================"
echo ""
echo "🌐 Server: http://138.249.7.234:3000"
echo ""
echo "📋 Foydali buyruqlar:"
echo "   pm2 status              - Server holati"
echo "   pm2 logs hodim-nazorati - Log'lar"
echo "   pm2 restart hodim-nazorati - Qayta ishga tushirish"
echo ""
