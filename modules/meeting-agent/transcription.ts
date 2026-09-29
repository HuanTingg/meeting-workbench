import type { AiAudioTranscription } from "./ai-model-runtime.js";

function localServiceBaseUrl(value: string) {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:") throw new Error("本地 FunASR 地址必须使用 http");
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)) throw new Error("本地 FunASR 仅允许连接本机地址");
  return parsed.toString().replace(/\/+$/u, "");
}

export function localFunAsrEndpoint(baseUrl: string, suffix: string) {
  const base = localServiceBaseUrl(baseUrl);
  return base.toLocaleLowerCase("en-US").endsWith(suffix) ? base : `${base}${suffix}`;
}

export async function callLocalFunAsr(baseUrl: string, audio: Buffer, fileName: string, mimeType: string, options: { model: string; diarization: boolean }): Promise<AiAudioTranscription> {
  const form = new FormData();
  const bytes = new Uint8Array(audio.byteLength);
  bytes.set(audio);
  form.append("file", new Blob([bytes], { type: mimeType || "application/octet-stream" }), fileName);
  form.append("model", options.model);
  form.append("language", "zh");
  form.append("response_format", "verbose_json");
  form.append("spk", String(options.diarization));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30 * 60_000);
  try {
    const token = process.env.FUNASR_INTERNAL_TOKEN?.trim();
    const response = await fetch(localFunAsrEndpoint(baseUrl, "/audio/transcriptions"), { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : undefined, body: form, signal: controller.signal });
    const raw = await response.text();
    let data: { text?: string; segments?: Array<{ speaker?: string | number; start?: number; end?: number; text?: string }>; detail?: string } = {};
    try { data = JSON.parse(raw); } catch { /* validate below */ }
    if (!response.ok) throw new Error(String(data.detail || `本地语音服务返回 HTTP ${response.status}`).slice(0, 500));
    const segments = (data.segments || []).map((item) => ({ speaker: item.speaker == null ? undefined : String(item.speaker), start: Number.isFinite(item.start) ? Math.max(0, Number(item.start)) : undefined, end: Number.isFinite(item.end) ? Math.max(0, Number(item.end)) : undefined, text: String(item.text || "").trim() })).filter((item) => item.text);
    const text = String(data.text || segments.map((item) => item.text).join("\n")).trim();
    if (!text) throw new Error("本地语音识别结果为空，请检查录音是否清晰");
    return { text, segments };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("本地语音识别超时");
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function checkLocalFunAsr(baseUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const token = process.env.FUNASR_INTERNAL_TOKEN?.trim();
    const response = await fetch(localFunAsrEndpoint(baseUrl, "/health"), { headers: token ? { authorization: `Bearer ${token}` } : undefined, signal: controller.signal });
    const data = await response.json().catch(() => ({})) as { model_loaded?: boolean; model?: string; device?: string; detail?: string };
    if (!response.ok) throw new Error(data.detail || `本地语音服务返回 HTTP ${response.status}`);
    if (!data.model_loaded) throw new Error("FunASR 模型仍在加载，请稍后重试");
    return data;
  } finally { clearTimeout(timeout); }
}
