#!/usr/bin/env bash
set -euo pipefail

# ==========================================
# Деплой WebSocket Tunnel на сервер
# ==========================================
# Использование:
#   1. Указать SERVER_IP или SERVER_DOMAIN ниже
#   2. Установить Docker на сервере
#   3. Запустить: ./deploy.sh
# ==========================================

SERVER="${SERVER:-root@tunnel.example.com}"
COMPOSE_FILE="docker-compose.yml"

echo "=== Deploying Tunnel Server ==="
echo "Target: $SERVER"

# 1. Копируем файлы на сервер
echo "--- Copying files ---"
rsync -avz \
  --exclude 'node_modules' \
  --exclude 'local-proxy' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude '*.md' \
  ./ "$SERVER:~/tunnel-server/"

# 2. Редактируем Caddyfile с доменом (первый запуск)
#    После деплоя нужно вручную указать домен в Caddyfile

# 3. Запускаем на сервере
echo "--- Starting services ---"
ssh "$SERVER" "cd ~/tunnel-server && docker compose up -d --build"

echo "=== Done ==="
echo "Local Proxy теперь подключается к: wss://tunnel.example.com"
echo ""
echo "Пример запуска Local Proxy:"
echo "  cd local-proxy"
echo "  WS_SSL=true WS_HOST=tunnel.example.com npm run start"
