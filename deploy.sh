#!/bin/bash

# Deployment Script for Hodim Nazorati
# Bu script serverga deploy qilishni soddalashtiradi

set -e

echo "=================================="
echo "Hodim Nazorati Deployment Script"
echo "=================================="
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ .env fayl topilmadi!"
    echo "📝 .env.example faylidan nusxa oling va ma'lumotlarni to'ldiring:"
    echo "   cp .env.example .env"
    echo "   nano .env"
    exit 1
fi

echo "✅ .env fayl topildi"
echo ""

# Install dependencies
echo "📦 Dependencies o'rnatilmoqda..."
npm install --production

echo ""
echo "✅ Dependencies o'rnatildi"
echo ""

# Check if migrations need to be run
read -p "Database migration'larni ishga tushirish kerakmi? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🔄 Migration'lar ishga tushirilmoqda..."
    npm run migrate
    echo "✅ Migration'lar bajarildi"
fi

echo ""
echo "🚀 Server ishga tushirilmoqda..."

# Check if PM2 is installed
if command -v pm2 &> /dev/null; then
    echo "✅ PM2 topildi, PM2 bilan ishga tushirilmoqda..."
    pm2 start ecosystem.config.js
    pm2 save
    echo ""
    echo "✅ Server PM2 bilan ishga tushirildi!"
    echo ""
    echo "📊 Server holatini ko'rish: pm2 status"
    echo "📋 Log'larni ko'rish: pm2 logs hodim-nazorati"
    echo "🔄 Qayta ishga tushirish: pm2 restart hodim-nazorati"
else
    echo "⚠️  PM2 topilmadi, oddiy node bilan ishga tushirilmoqda..."
    echo "📝 PM2 o'rnatish: npm install -g pm2"
    NODE_ENV=production node server.js
fi

echo ""
echo "=================================="
echo "✅ Deployment muvaffaqiyatli!"
echo "=================================="
