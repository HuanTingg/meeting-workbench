#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
docker info --format '{{.OSType}}'
docker run --rm --user "$(id -u):$(id -g)" --mount "type=bind,source=$(pwd),target=/workspace" -w /workspace node:22-bookworm-slim node scripts/configure-docker.mjs
docker compose --env-file .env.docker up -d --build --wait db web
echo '部署成功。默认地址 http://localhost:8765（修改过端口时使用配置值）。'
echo '读取初始账号：docker compose --env-file .env.docker exec web cat /app/data/initial-admin.json'
