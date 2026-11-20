#!/usr/bin/env bash
# three.js'i (0.180.0) npm'den indirip oyunun vendor klasörüne koyar. GitHub Actions derlemesi bunu çalıştırır.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/android/app/src/main/assets/game/vendor"
TMP="$(mktemp -d)"
cd "$TMP"
npm pack three@0.180.0 --silent >/dev/null
tar xzf three-0.180.0.tgz
mkdir -p "$DEST/jsm/loaders" "$DEST/jsm/utils"
cp package/build/three.module.js package/build/three.core.js "$DEST/"
cp package/examples/jsm/loaders/GLTFLoader.js "$DEST/jsm/loaders/"
cp package/examples/jsm/utils/BufferGeometryUtils.js "$DEST/jsm/utils/"
cp package/LICENSE "$DEST/LICENSE-three.txt"
rm -rf "$TMP"
echo "three.js hazır: $DEST"
ls -la "$DEST"
