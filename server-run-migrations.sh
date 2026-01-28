#!/bin/bash

# Server'da database migration'larni bajarish skripti

echo "============================================"
echo "Database Migration'larni Bajarish"
echo "============================================"
echo ""

# Loyiha papkasiga o'tish
cd /var/www/restocontrol

# .env fayl mavjudligini tekshirish
if [ ! -f ".env" ]; then
    echo "⚠️  .env fayl topilmadi!"
    echo "📝 Iltimos, .env faylini yarating va database sozlamalarini kiriting"
    exit 1
fi

echo "1. Database ulanishini tekshirish..."
node -e "
const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'hodim_nazorati',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});
pool.query('SELECT NOW()').then(() => {
  console.log('✅ Database ulanishi muvaffaqiyatli');
  process.exit(0);
}).catch(err => {
  console.error('❌ Database ulanishi xatosi:', err.message);
  process.exit(1);
});
"

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Database ulanishi muvaffaqiyatsiz. Iltimos, .env faylini tekshiring."
    exit 1
fi

echo ""
echo "2. Migration'larni bajarish..."
node run-migrations.js

if [ $? -eq 0 ]; then
    echo ""
    echo "============================================"
    echo "✅ Migration'lar muvaffaqiyatli bajarildi!"
    echo "============================================"
    echo ""
    echo "📋 Keyingi qadamlar:"
    echo "   - PM2 serverini qayta ishga tushirish: pm2 restart hodim-nazorati"
    echo ""
else
    echo ""
    echo "============================================"
    echo "❌ Migration'larda xatolik bo'ldi!"
    echo "============================================"
    echo ""
    echo "⚠️  Iltimos, yuqoridagi xatoliklarni tekshiring."
    exit 1
fi
