

async function saveMorningMeetingTranscription(button?: HTMLButtonElement, silent = false) {
  if (!teamSystemSettingsCanManage) return false;
  const enabled = qs<HTMLSelectElement>("#morningTranscriptionEnabled")?.value !== "false";
  const provider = "funasr-local";
  const baseUrl = qs<HTMLInputElement>("#morningTranscriptionBaseUrl")?.value.trim() || "";
  const aiConfigId = qs<HTMLSelectElement>("#morningTranscriptionAiConfig")?.value || "";
  const model = qs<HTMLInputElement>("#morningTranscriptionModel")?.value.trim() || "";
  const diarization = qs<HTMLSelectElement>("#morningTranscriptionDiarization")?.value !== "false";
  const maxUploadMb = Number(qs<HTMLInputElement>("#morningTranscriptionMaxUpload")?.value || 60);
  if (!baseUrl) { toast("请填写本地 FunASR 服务地址", "error"); return false; }
  if (!model) { toast("请填写语音转写模型", "error"); return false; }
  if (!Number.isInteger(maxUploadMb) || maxUploadMb < 5 || maxUploadMb > 60) { toast("录音上限应为 5–60 MB 的整数", "error"); return false; }
  try {
    if (button) setButtonPending(button, true, "保存设置", "保存中");
    const result = await api<{ settings: TeamSystemSettings }>("/api/system-settings/morning-meeting-transcription", { method: "PUT", body: JSON.stringify({ enabled, provider, baseUrl, aiConfigId, model, diarization, maxUploadMb }) });
    teamSystemSettings = result.settings;
    renderTeamSystemSettings();
    if (!silent) toast("晨会录音识别设置已保存", "success");
    return true;
  } catch (error) {
    toast(error instanceof Error ? error.message : "晨会录音识别设置保存失败", "error");
    return false;
  } finally {
    if (button) setButtonPending(button, false, "保存设置", "保存中");
  }
}


async function testMorningMeetingTranscription(button?: HTMLButtonElement) {
  if (!(await saveMorningMeetingTranscription(undefined, true))) return;
  try {
    if (button) setButtonPending(button, true, "检查配置", "检查中");
    const result = await api<{ ok: boolean; message: string }>("/api/system-settings/morning-meeting-transcription/test", { method: "POST" });
    toast(result.message, result.ok ? "success" : "error");
  } catch (error) {
    toast(error instanceof Error ? error.message : "晨会录音识别配置检查失败", "error");
  } finally {
    if (button) setButtonPending(button, false, "检查配置", "检查中");
  }
}