$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0) { throw '请先启动 Docker Desktop（Linux 容器）' }
docker run --rm --mount "type=bind,source=$PWD,target=/workspace" -w /workspace node:22-bookworm-slim node scripts/configure-docker.mjs
if ($LASTEXITCODE -ne 0) { throw '初始化配置失败' }
docker compose --env-file .env.docker up -d --build --wait db web
if ($LASTEXITCODE -ne 0) { throw '部署未通过健康检查，请检查 compose logs' }
Write-Host '部署成功。默认地址 http://localhost:8765（修改过端口时使用配置值）。'
Write-Host '读取初始账号：docker compose --env-file .env.docker exec web cat /app/data/initial-admin.json'
