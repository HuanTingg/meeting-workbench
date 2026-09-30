# 会议纪要管理 · Meeting Workbench

录音转写、AI 会议纪要与任务解析、成员待办、完成证明、钉钉与飞书通知。

## 交给 AI 部署

将仓库链接和下面这段话发给能操作终端的 AI：

> 请阅读 AGENTS.md 和 docs/部署指南.md，按本机系统执行原生部署。必须安装 MySQL、FunASR、FFmpeg 并下载全部四组模型，验证数据库、模型健康和登录页面。不覆盖已有配置和数据，完成后给我网页地址及读取初始密码的方法。私有仓库需要我的 GitHub 访问权限。

## Windows / Mac 命令网页版

无需 Docker，不制作安装包、桌面 EXE 或快捷图标。先安装 Git，也可以在 GitHub 中选择 Code → Download ZIP 后解压。

```bash
git clone https://github.com/HuanTingg/meeting-workbench.git
cd meeting-workbench
```

Windows 10/11 x64，PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1
```

macOS，终端：

```bash
bash scripts/deploy.sh
```

首次运行自动准备 Node.js、Python 3.12、MySQL、FFmpeg、FunASR，以及语音识别、语音活动检测、标点和说话人四组模型。任何必需步骤失败都会停止，不会跳过录音功能。

首次部署需要联网、数 GB 下载空间，建议至少 8 GB 内存、15 GB 可用磁盘。Mac 首次安装 Homebrew / 开发工具可能要求输入系统密码；Windows 缺少 winget 时需安装微软“应用安装程序”。

显示“部署已就绪”后打开 **http://127.0.0.1:8765**。保持终端运行，Ctrl+C 停止。新部署在终端读取初始账号（首次登录必须改密）：

Windows：`Get-Content data/initial-admin.json`；Mac：`cat data/initial-admin.json`。

下次启动无需重复安装：

```powershell
# Windows
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy.ps1 -StartOnly
```

```bash
# Mac
bash scripts/deploy.sh --start
```

已有 `.env` 的原生部署保留原数据库与账号。AI、钉钉、飞书仍需填写部署者自己的服务密钥和应用配置。

## 文档与开发

- [部署、排错、局域网访问和备份](docs/部署指南.md)
- [账号与完成证明](docs/账号与完成证明.md)
- [飞书接入](docs/飞书接入说明.md)
- [钉钉接入](docs/钉钉接入.md)
- [MySQL 存储](docs/MySQL存储说明.md)

开发检查：Node.js 22+，`npm ci`、`npm run build`、`npm test`。

仓库不包含真实账号、密钥、录音、数据库或模型。仓库私有时，其他人需要访问权限。第三方组件和模型遵守各自许可证。旧 Compose 文件保留供已有容器部署维护，不再作为默认部署入口。
