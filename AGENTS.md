# AI 部署入口

先阅读 README.md 和 docs/部署指南.md。默认原生命令网页版：Windows 使用 scripts/deploy.ps1；macOS 使用 bash scripts/deploy.sh。无需 Docker、桌面安装包或图标。

- 必须准备 MySQL、Python、FFmpeg、FunASR 和全部四组模型，不提供跳过语音的默认流程。
- 保留已有 .env、数据库、账号和附件，不覆盖凭据、不删数据排错。新部署由脚本创建独立随机凭据和管理员。
- 验收 MySQL、模型健康、登录页，提供网页地址和在用户终端读取 initial-admin.json 的方法，不公开密码。
- AI、钉钉、飞书需要用户自己的配置；不发送真实通知测试。
- 代码验证 npm ci、npm run build、npm test。MYSQLD_TEST_PATH 可启用独立临时 MySQL 集成测试。
- 不运行原 CRM 提取脚本部署项目。未要求时保持仓库私有。
- 下载或平台验证受阻时如实说明，不声称全部环境已验证。
