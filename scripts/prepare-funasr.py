"""Required deployment gate: download all four models and actually load them."""
import os
import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault('MODELSCOPE_CACHE', str(ROOT / '.runtime' / 'models'))
os.environ.setdefault('FUNASR_CPU_THREADS', '2')
os.environ.setdefault('FUNASR_DEVICE', 'cpu')
import imageio_ffmpeg
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-version'], check=True, stdout=subprocess.DEVNULL)
print('FFmpeg 已就绪。正在检查并下载四组语音模型，请等待…', flush=True)
from modelscope import snapshot_download
names = {
    'FUNASR_ASR_MODEL': 'speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
    'FUNASR_VAD_MODEL': 'speech_fsmn_vad_zh-cn-16k-common-pytorch',
    'FUNASR_PUNC_MODEL': 'punc_ct-transformer_cn-en-common-vocab471067-large',
    'FUNASR_SPEAKER_MODEL': 'speech_campplus_sv_zh-cn_16k-common',
}
for index, (key, name) in enumerate(names.items(), 1):
    print(f'[{index}/4] {name}', flush=True)
    os.environ[key] = snapshot_download('iic/' + name)
from services.funasr.app import load_model
load_model()
print('四组模型实际加载通过，录音转写部署完成。', flush=True)
