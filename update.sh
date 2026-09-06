#!/usr/bin/env bash
set -e

echo "======================================================"
echo "🔄 [Update] Memperbarui Local AI Clipper"
echo "======================================================"

# 1. Nonaktifkan pelacakan perubahan permission file (sangat penting untuk Termux / storage Android)
git config core.fileMode false 2>/dev/null || true

# 2. Amankan perubahan lokal jika ada (misal modifikasi konfigurasi)
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  echo "⚠️ [Update] Menyimpan perubahan lokal sementara (git stash)..."
  git stash save "auto-stash-before-update" 2>/dev/null || true
  HAS_STASH=true
else
  HAS_STASH=false
fi

# 3. Tarik update terbaru dari GitHub
echo "⬇️ [Update] Mengambil kode terbaru dari GitHub..."
git fetch origin main
git pull origin main

if [ "$HAS_STASH" = true ]; then
  echo "📦 [Update] Mengembalikan perubahan lokal Anda..."
  git stash pop 2>/dev/null || true
fi

# 4. Update yt-dlp jika Python tersedia (penting untuk download YouTube)
if command -v pip &> /dev/null || command -v pip3 &> /dev/null; then
  echo "⬇️ [Update] Memperbarui yt-dlp ke versi terbaru..."
  pip install -U yt-dlp --quiet 2>/dev/null || python -m pip install -U yt-dlp --quiet 2>/dev/null || true
fi

# 5. Install / perbarui dependensi server
echo "📦 [Update] Memperbarui dependensi server..."
if [ -f server/package-lock.json ]; then
  (cd server && npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts)
else
  (cd server && npm install --ignore-scripts)
fi

# 6. Install / perbarui dependensi client
echo "📦 [Update] Memperbarui dependensi client..."
if [ -f client/package-lock.json ]; then
  (cd client && npm ci 2>/dev/null || npm install)
else
  (cd client && npm install)
fi

# 7. Build production bundle client jika diperlukan
if [ -f client/package.json ]; then
  echo "🔨 [Update] Membangun frontend client..."
  (cd client && npm run build 2>/dev/null || true)
fi

echo "======================================================"
echo "✅ [Update] Pembaruan selesai!"
echo "📌 Commit aktif: $(git log -1 --oneline)"
echo "🚀 Jalankan aplikasi dengan: npm run dev"
echo "======================================================"
