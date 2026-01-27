#!/bin/bash

# Git'ga Loyihani Joylash - Linux/Mac Script
# Bu script Git repository yaratishni soddalashtiradi

set -e

echo "========================================"
echo "Git Repository Yaratish va GitHub'ga Yuklash"
echo "========================================"
echo ""

# Check if Git is installed
if ! command -v git &> /dev/null; then
    echo "❌ Git o'rnatilmagan!"
    echo "📝 Git o'rnatish: https://git-scm.com/download"
    exit 1
fi

echo "✅ Git topildi"
echo ""

# Check if already a git repository
if [ -d .git ]; then
    echo "ℹ️  Git repository allaqachon mavjud"
    git status
    echo ""
    echo "📋 Keyingi qadamlar:"
    echo "   1. git add ."
    echo "   2. git commit -m \"Commit message\""
    echo "   3. git remote add origin https://github.com/username/repo.git"
    echo "   4. git push -u origin main"
    exit 0
fi

echo "🚀 Git repository yaratilmoqda..."
git init

echo "✅ Git repository yaratildi"
echo ""

echo "📦 Barcha fayllar qo'shilmoqda..."
git add .

echo ""
read -p "Commit xabari (Initial commit): " COMMIT_MSG
COMMIT_MSG=${COMMIT_MSG:-"Initial commit - Hodim Nazorati loyihasi"}

git commit -m "$COMMIT_MSG"

echo ""
echo "✅ Commit qilindi"
echo ""

echo "========================================"
echo "Keyingi Qadamlar:"
echo "========================================"
echo ""
echo "1. GitHub'da repository yarating:"
echo "   - https://github.com/new ga kiring"
echo "   - Repository nomini kiriting"
echo "   - \"Create repository\" tugmasini bosing"
echo ""
echo "2. Remote repository qo'shing:"
echo "   git remote add origin https://github.com/USERNAME/REPO.git"
echo ""
echo "3. Branch nomini main qiling:"
echo "   git branch -M main"
echo ""
echo "4. GitHub'ga yuklang:"
echo "   git push -u origin main"
echo ""
echo "========================================"
echo "✅ Git repository tayyor!"
echo "========================================"
