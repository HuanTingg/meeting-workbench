# AI 部署入口

用户要求部署时先阅读 README.md 和 docs/部署指南.md。

- 检查 GitHub 访问权限、Docker daemon、Compose v2.24+、Linux 容器和目标端口。使用 scripts/deploy.ps1 或 scripts/deploy.sh；不需要宿主 Node/MySQL。
- 默认 localhost:8765。需要局域网访问时设置 .env.docker 的监听地址、端口和允许的 Host。
- 配置文件自动生成随机密码，已存在时保留。不得上传密钥或连接原作者数据库。
- 验收 compose ps、/api/health 和登录页，提供访问地址和读取 initial-admin.json 的终端命令。初始密码不要贴到公开消息。
- 录音按需启用 speech，等待模型健康；AI、钉钉、飞书仍需用户自己的配置。
- 更新前保留配置与数据；不要删数据卷排障，不覆盖已有管理员。
- 不发送真实通知测试。scripts/test-compose.mjs 会修改密码和创建待办，只能用于明确的全新临时测试项目。
- 代码验证：npm ci、npm run build、npm test。Compose 验证见 .github/workflows/verify.yml。不要运行原 CRM 提取脚本安装项目。
- 未明确要求时保持仓库私有。部署或下载受阻应如实报告，不声称已验证。
