"""Start this workspace's isolated local speech service."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("MODELSCOPE_CACHE", str(ROOT / ".runtime" / "models"))
os.environ.setdefault("FUNASR_DEVICE", "cpu")
os.environ.setdefault("FUNASR_CPU_THREADS", "2")
os.environ.setdefault("PYTHONUTF8", "1")
for key, folder in {
    "FUNASR_ASR_MODEL": "speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
    "FUNASR_VAD_MODEL": "speech_fsmn_vad_zh-cn-16k-common-pytorch",
    "FUNASR_PUNC_MODEL": "punc_ct-transformer_cn-en-common-vocab471067-large",
    "FUNASR_SPEAKER_MODEL": "speech_campplus_sv_zh-cn_16k-common",
}.items():
    local = ROOT / ".runtime" / "models" / "models" / "iic" / folder
    if (local / "model.pt").exists() or (local / "campplus_cn_common.bin").exists():
        os.environ.setdefault(key, str(local))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("services.funasr.app:app", host="127.0.0.1", port=10097)

