#!/bin/bash
# 公開版のキャッシュ（max-age=600）を避けるため、モジュールとCSSの版の印を一括で上げる。
# 使い方: tools/bump.sh 20261017c
set -e
cd "$(dirname "$0")/.."
NEW="$1"; [ -n "$NEW" ] || { echo "版の印を渡せ"; exit 1; }
OLD=$(grep -o 'v=2026[0-9a-z]*' index.html | head -1 | cut -d= -f2)
sed -i '' "s/$OLD/$NEW/g" index.html app.js engine.mjs rewards.mjs sw.js
echo "$OLD -> $NEW"
