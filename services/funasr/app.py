"""会议纪要 晨会录音本地转写服务。

识别结果整理逻辑参考 cheatofrom/meeting 的 meeting_api_server.py，
服务边界、路径、鉴权方式和音频规范化针对会议纪要 重新实现。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

import torch
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from funasr import AutoModel


SERVICE_TOKEN = os.getenv("FUNASR_INTERNAL_TOKEN", "").strip()
MODEL_NAME = os.getenv("FUNASR_ASR_MODEL", "paraformer-zh").strip() or "paraformer-zh"
VAD_MODEL = os.getenv("FUNASR_VAD_MODEL", "fsmn-vad").strip() or "fsmn-vad"
PUNC_MODEL = os.getenv("FUNASR_PUNC_MODEL", "ct-punc").strip() or "ct-punc"
SPEAKER_MODEL = os.getenv("FUNASR_SPEAKER_MODEL", "cam++").strip() or "cam++"
DEVICE = os.getenv("FUNASR_DEVICE", "cpu").strip() or "cpu"
MAX_UPLOAD_MB = max(5, min(200, int(os.getenv("FUNASR_MAX_UPLOAD_MB", "60"))))
MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

model: AutoModel | None = None


def require_internal_token(authorization: str | None) -> None:
    if SERVICE_TOKEN and authorization != f"Bearer {SERVICE_TOKEN}":
        raise HTTPException(status_code=401, detail="本地语音服务鉴权失败")


def load_model() -> AutoModel:
    torch.set_num_threads(max(1, int(os.getenv("FUNASR_CPU_THREADS", "4"))))
    return AutoModel(
        model=MODEL_NAME,
        vad_model=VAD_MODEL,
        punc_model=PUNC_MODEL,
        spk_model=SPEAKER_MODEL,
        device=DEVICE,
        disable_update=True,
        vad_kwargs={"max_single_segment_time": 30000},
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    global model
    model = load_model()
    yield
    model = None


app = FastAPI(title="会议纪要 FunASR", version="1.0", lifespan=lifespan)


def normalize_audio(source: Path, target: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        try:
            import imageio_ffmpeg
            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError as exc:
            raise RuntimeError("未找到 FFmpeg，请重新运行部署命令") from exc
    result = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(target)],
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if result.returncode != 0 or not target.exists() or target.stat().st_size == 0:
        detail = (result.stderr or "音频转换失败").strip()[-500:]
        raise RuntimeError(detail)


def merge_segments(raw_result: list[dict]) -> list[dict]:
    """按说话人和相邻时间合并 FunASR sentence_info。"""
    if not raw_result or not isinstance(raw_result[0], dict):
        return []
    sentences = raw_result[0].get("sentence_info") or []
    merged: list[dict] = []
    for sentence in sentences:
        text = str(sentence.get("text") or sentence.get("sentence") or "").strip()
        if not text:
            continue
        speaker = str(sentence.get("spk", 0))
        start = max(0.0, float(sentence.get("start", 0)) / 1000)
        end = max(start, float(sentence.get("end", 0)) / 1000)
        previous = merged[-1] if merged else None
        if previous and previous["speaker"] == speaker and start <= previous["end"] + 1:
            previous["text"] += text
            previous["end"] = end
        else:
            merged.append({"speaker": speaker, "start": start, "end": end, "text": text})
    return merged


@app.get("/health")
@app.get("/v1/health")
def health(authorization: str | None = Header(default=None)):
    # 仅返回运行状态，方便本机守护程序探活；服务本身只监听回环地址。
    del authorization
    return {
        "status": "ok" if model is not None else "loading",
        "model_loaded": model is not None,
        "model": MODEL_NAME,
        "device": DEVICE,
        "speaker_model": SPEAKER_MODEL,
    }


@app.get("/v1/models")
def models(authorization: str | None = Header(default=None)):
    require_internal_token(authorization)
    return {"object": "list", "data": [{"id": MODEL_NAME, "object": "model"}]}


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model_name: str = Form(default=MODEL_NAME, alias="model"),
    language: str = Form(default="zh"),
    response_format: str = Form(default="verbose_json"),
    spk: bool = Form(default=True),
    authorization: str | None = Header(default=None),
):
    del language, response_format
    require_internal_token(authorization)
    if model is None:
        raise HTTPException(status_code=503, detail="语音模型仍在加载")
    if model_name not in {MODEL_NAME, "funasr-local", "paraformer"}:
        raise HTTPException(status_code=400, detail=f"不支持的语音模型：{model_name}")
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="录音文件为空")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"单个录音不能超过 {MAX_UPLOAD_MB}MB")

    suffix = Path(file.filename or "meeting.wav").suffix or ".bin"
    with tempfile.TemporaryDirectory(prefix="meeting-funasr-") as temporary:
        source = Path(temporary) / f"source{suffix}"
        normalized = Path(temporary) / "normalized.wav"
        source.write_bytes(content)
        try:
            normalize_audio(source, normalized)
            result = model.generate(
                input=str(normalized),
                batch_size_s=300,
                sentence_timestamp=True,
                return_spk_res=spk,
            )
            segments = merge_segments(result)
            text = "".join(segment["text"] for segment in segments).strip()
            if not text and result:
                text = str(result[0].get("text", "")).strip()
            if not text:
                raise HTTPException(status_code=422, detail="没有识别到清晰语音")
            return {"text": text, "segments": segments, "model": MODEL_NAME}
        except HTTPException:
            raise
        except subprocess.TimeoutExpired as error:
            raise HTTPException(status_code=504, detail="音频转换超时") from error
        except Exception as error:
            raise HTTPException(status_code=500, detail=f"本地语音识别失败：{error}") from error


