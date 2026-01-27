#!/bin/bash
# Server'da to'liq loyihani Git'dan yangilash

echo "============================================"
echo "Loyihani Git'dan Yangilash"
echo "============================================"
echo ""

# Loyiha papkasiga o'tish
cd /var/www/restocontrol || {
    echo "❌ /var/www/restocontrol papkasi topilmadi!"
    exit 1
}

echo "1. Joriy holatni tekshirish..."
git status

echo ""
echo "2. Eski fayllarni backup qilish..."
BACKUP_DIR="backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Muhim fayllarni backup qilish
if [ -f "server.js" ]; then
    cp server.js "$BACKUP_DIR/server.js.backup"
    echo "✅ server.js backup qilindi"
fi

if [ -f "package.json" ]; then
    cp package.json "$BACKUP_DIR/package.json.backup"
    echo "✅ package.json backup qilindi"
fi

if [ -d "public" ]; then
    cp -r public "$BACKUP_DIR/public.backup" 2>/dev/null || echo "⚠️  public papkasi backup qilinmadi"
fi

if [ -d "services" ]; then
    cp -r services "$BACKUP_DIR/services.backup" 2>/dev/null || echo "⚠️  services papkasi backup qilinmadi"
fi

echo ""
echo "3. Git'dan yangilash..."

# Joriy branch nomini aniqlash (default: main)
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
echo "   Joriy branch: $CURRENT_BRANCH"

git fetch origin "$CURRENT_BRANCH"
if [ $? -ne 0 ]; then
    echo "❌ Git fetch xatolik!"
    exit 1
fi

git reset --hard "origin/$CURRENT_BRANCH"
if [ $? -ne 0 ]; then
    echo "❌ Git reset xatolik!"
    exit 1
fi

echo ""
echo "4. Yangi fayllarni tekshirish..."
if [ -f "server.js" ]; then
    echo "✅ server.js mavjud"
    echo "   Qatorlar soni: $(wc -l < server.js)"
else
    echo "❌ server.js topilmadi!"
    exit 1
fi

if [ -f "package.json" ]; then
    echo "✅ package.json mavjud"
else
    echo "⚠️  package.json topilmadi"
fi

if [ -d "public" ]; then
    echo "✅ public papkasi mavjud"
else
    echo "⚠️  public papkasi topilmadi"
fi

if [ -d "services" ]; then
    echo "✅ services papkasi mavjud"
else
    echo "⚠️  services papkasi topilmadi"
fi

echo ""
echo "5. Node modules tekshirish..."
if [ -d "node_modules" ]; then
    echo "✅ node_modules mavjud"
    # package.json o'zgarganga, npm install qilish kerak bo'lishi mumkin
    if [ -f "package.json" ]; then
        echo "ℹ️  package.json o'zgargan bo'lishi mumkin, npm install tavsiya etiladi"
    fi
else
    echo "⚠️  node_modules topilmadi, npm install qilish kerak"
fi

echo ""
echo "6. PM2 qayta ishga tushirish..."
pm2 restart restocontrol --update-env
if [ $? -ne 0 ]; then
    echo "⚠️  PM2 restart xatolik yoki restocontrol process topilmadi"
    echo "   Qo'lda ishga tushirish: pm2 start server.js --name restocontrol"
else
    echo "✅ PM2 qayta ishga tushirildi"
fi

echo ""
echo "7. Log'larni tekshirish (5 soniya kutib)..."
sleep 5
pm2 logs restocontrol --lines 30 --nostream

echo ""
echo "============================================"
echo "✅ Yangilash bajarildi!"
echo "============================================"
echo ""
echo "Backup papkasi: $BACKUP_DIR"
echo ""
echo "Agar xatolik bo'lsa:"
echo "  pm2 logs restocontrol --err"
echo "  pm2 restart restocontrol"
echo "  yoki backup'dan qaytarish:"
echo "    cp $BACKUP_DIR/server.js.backup server.js"
echo ""
echo "Agar package.json o'zgarganga:"
echo "  npm install"
echo "  pm2 restart restocontrol"
