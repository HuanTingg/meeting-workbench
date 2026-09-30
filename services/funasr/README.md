# FunASR 本地转写

原生部署入口为项目根目录的 `scripts/deploy.ps1`（Windows）或 `bash scripts/deploy.sh`（Mac）。录音转写为必装组件，部署会下载并实际加载中文识别、语音活动检测、标点恢复和匿名说话人区分四组模型。无需单独安装 PATH 中的 FFmpeg，依赖包自带可执行程序。

Python 环境：`.runtime/funasr-venv`；模型：`.runtime/models`。使用 CPU，Python 3.12、FunASR 1.2.7；PyTorch / torchaudio 默认 2.5.1，Intel Mac 使用支持该平台的 2.2.2，详见 requirements-native.txt。

转写地址：http://127.0.0.1:10097/v1 。健康检查：http://127.0.0.1:10097/health ，必须返回 model_loaded: true。原生启动日志：logs/native-funasr.log。通过 FUNASR_PORT 可调整端口，同时需要更新网页智能配置中的转写地址。

先停止旧转写进程，再重新完整部署，避免同时加载两份模型消耗内存。日常启动使用部署脚本的 -StartOnly / --start 参数。

说话人编号不等于员工身份，仍需在审核页确认负责人。录音在本机转写；启用远程 AI 后，转写文字会按智能配置发送给该 AI 服务。
