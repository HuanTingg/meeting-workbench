# FunASR 本地转写

运行目录：services/funasr；独立 Python 环境：.runtime/funasr-venv；模型：.runtime/models。

CPU 模式，PyTorch / torchaudio 固定 2.5.1，FunASR 1.2.7。包含中文识别、语音活动检测、标点恢复和匿名说话人区分。说话人编号不等于员工身份，仍需在审核页确认负责人。

双击「启动录音转写.cmd」单独启动服务；「启动会议工作台.cmd」也会尝试后台启动它。启动器检查现有进程，不会重复加载同一项目的模型。

地址：http://127.0.0.1:10097/v1
健康检查：http://127.0.0.1:10097/health
日志：logs/funasr.out.log、logs/funasr.err.log

首次加载模型需要等待；录音在本地 CPU 转写。FFmpeg 必须在 PATH 中。网页使用的转写基础地址已配置在 MySQL。启用远程 AI 后，转写文字仍会按智能配置发送给该 AI 服务。

