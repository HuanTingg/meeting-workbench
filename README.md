# 会议纪要管理 · Meeting Workbench

录音转写、AI 会议纪要与任务解析、成员待办、完成证明、钉钉与飞书通知。

## 交给 AI 部署

把仓库链接和这段话发给能操作终端的 AI：

> 请部署这个仓库，先阅读 AGENTS.md 和 docs/部署指南.md。使用 Docker Compose 创建独立数据库和管理员，不覆盖现有配置或数据。验证健康状态和登录页后，提供访问地址与安全获取初始密码的方法。默认本机访问，需要录音时启用 speech。私有仓库先确认我的账号有访问权限。

## 快速启动

安装并启动 Docker（Linux 容器）和 Git，然后执行：

```bash
git clone https://github.com/HuanTingg/meeting-workbench.git
cd meeting-workbench
```

Windows PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1
```

Linux/macOS：

```bash
sh scripts/deploy.sh
```

脚本自动生成独立密码、构建应用、启动 MySQL、建表并创建管理员。无需安装本机 Node/MySQL。打开 **http://localhost:8765**，在自己的终端读取初始账号：

```bash
docker compose --env-file .env.docker exec web cat /app/data/initial-admin.json
```

首次登录强制改密。重复部署不会重置账号和数据。文字稿与待办可直接使用；AI 和通知使用部署者自己的配置。

## 可选录音转写

```bash
docker compose --env-file .env.docker --profile speech up -d --build funasr
```

首次下载模型可能较慢。转写地址填 http://funasr:10097/v1，等待模型健康再上传录音。

## 文档

- [部署、验收、局域网访问、更新与备份](docs/部署指南.md)
- [账号与完成证明](docs/账号与完成证明.md)
- [飞书接入](docs/飞书接入说明.md)
- [钉钉接入](docs/钉钉接入.md)
- [MySQL 存储](docs/MySQL存储说明.md)

## 开发

Node.js 22+：npm ci、npm run build、npm test。现有本地部署仍可使用 .env 和启动脚本；新环境推荐 Compose，完成空数据库与账号初始化。

app 为当前应用，modules/meeting-agent/view.html 和 shared 是构建资源。reference 原 CRM 追溯副本不上传，verify:extraction 仅适用于保留该副本的本地工作区。

仓库不包含真实账号、数据库、密钥、录音、附件和模型。增加部署脚本不会改变 GitHub 私有状态，其他人必须获得仓库访问权限。第三方代码和模型遵守各自许可证。
