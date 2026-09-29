
app.use("/api/morning-meetings/upload", express.raw({
  type: ["audio/*", "video/mp4", "application/octet-stream", "application/markdown", "text/markdown", "text/x-markdown", "text/plain"],
  limit: process.env.MORNING_MEETING_MAX_UPLOAD || "60mb"
}));


function morningMeetingTranscriptionForTeam(teamId: string) {
  const raw = teamSystemSettingsForTeam(teamId).morningMeetingTranscription;
  return {
    enabled: raw?.enabled !== false,
    provider: raw?.provider === "openai-compatible" ? "openai-compatible" as const : "funasr-local" as const,
    baseUrl: String(raw?.baseUrl || process.env.FUNASR_BASE_URL || "http://127.0.0.1:10096/v1").trim(),
    aiConfigId: String(raw?.aiConfigId || "").trim(),
    model: String(raw?.model || (raw?.provider === "openai-compatible" ? "gpt-4o-transcribe-diarize" : "paraformer-zh")).trim() || "paraformer-zh",
    diarization: raw?.diarization !== false,
    maxUploadMb: Math.max(5, Math.min(60, Number(raw?.maxUploadMb || 60)))
  };
}


const morningMeetingDirectory = path.resolve(
  process.env.GOODJOB_UPLOADS_DIR?.trim() || path.resolve(process.cwd(), "uploads"),
  ".morning-meetings"
);


function canManageMorningMeetings(user: SessionUser) {
  return ["manager", "admin", "super_admin"].includes(user.role);
}


function assertMorningMeetingManager(req: Request, res: Response) {
  if (canManageMorningMeetings(req.user!)) return true;
  res.status(403).json({ message: "仅负责人或管理员可以管理会议 Agent" });
  return false;
}


function findMorningMeeting(req: Request, res: Response) {
  const meeting = getStore().morningMeetings.find((item) => item.id === req.params.id);
  if (!meeting || (req.user!.role !== "super_admin" && meeting.teamId !== req.user!.teamId)) {
    res.status(404).json({ message: "晨会记录不存在" });
    return null;
  }
  return meeting;
}


function morningMeetingMembers(user: SessionUser) {
  return getStore().users
    .filter((item) => item.status === "active" && (user.role === "super_admin" || item.teamId === user.teamId))
    .map((item) => ({ id: item.id, name: item.name, role: item.role, teamId: item.teamId }));
}


app.get("/api/morning-meetings", requireAuth, (req, res) => {
  if (!assertMorningMeetingManager(req, res)) return;
  const meetings = getStore().morningMeetings
    .filter((item) => req.user!.role === "super_admin" || item.teamId === req.user!.teamId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  res.json({ meetings, members: morningMeetingMembers(req.user!) });
});


app.get("/api/morning-meetings/:id", requireAuth, (req, res) => {
  if (!assertMorningMeetingManager(req, res)) return;
  const meeting = findMorningMeeting(req, res);
  if (!meeting) return;
  res.json({ meeting, members: morningMeetingMembers(req.user!) });
});


app.post("/api/morning-meetings/upload", requireAuth, asyncRoute(async (req, res) => {
  if (!assertMorningMeetingManager(req, res)) return;
  const transcriptionSettings = morningMeetingTranscriptionForTeam(req.user!.teamId);
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400).json({ message: "请选择晨会录音或 Markdown 文字稿" });
    return;
  }
  const mimeType = String(req.headers["content-type"] || "application/octet-stream").split(";")[0]!.trim();
  const originalFileName = String(req.query.fileName || "晨会录音").slice(0, 255);
  const isMarkdown = /\.md$/iu.test(originalFileName) || ["application/markdown", "text/markdown", "text/x-markdown"].includes(mimeType);
  const allowedRecordingTypes = new Set(["audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/3gpp", "audio/amr", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "video/mp4", "application/octet-stream"]);
  const allowedMarkdownTypes = new Set(["application/markdown", "text/markdown", "text/x-markdown", "text/plain", "application/octet-stream"]);
  if ((!isMarkdown && !allowedRecordingTypes.has(mimeType)) || (isMarkdown && !allowedMarkdownTypes.has(mimeType))) {
    res.status(415).json({ message: "仅支持 MP3、M4A、WAV、WebM、OGG、MP4 录音或 Markdown 文字稿" });
    return;
  }
  if (!isMarkdown && !transcriptionSettings.enabled) {
    res.status(409).json({ message: "晨会录音识别尚未启用；可先启用录音识别，或上传 Markdown 文字稿" });
    return;
  }
  const markdownTranscript = isMarkdown ? req.body.toString("utf8").replace(/^\uFEFF/u, "").trim() : "";
  if (isMarkdown && !markdownTranscript) {
    res.status(400).json({ message: "Markdown 文字稿没有可解析的内容" });
    return;
  }
  if (isMarkdown && markdownTranscript.length > 60_000) {
    res.status(413).json({ message: "Markdown 文字稿不能超过 60000 个字符" });
    return;
  }
  if (!isMarkdown && req.body.length > transcriptionSettings.maxUploadMb * 1024 * 1024) {
    res.status(413).json({ message: `录音文件不能超过 ${transcriptionSettings.maxUploadMb} MB` });
    return;
  }
  const now = new Date().toISOString();
  const id = `mm_${randomUUID()}`;
  const extension = path.extname(originalFileName).replace(/[^.a-z0-9]/giu, "").slice(0, 10) || ".audio";
  const audioFileName = `${id}${extension}`;
  await mkdir(morningMeetingDirectory, { recursive: true });
  await writeFile(path.join(morningMeetingDirectory, audioFileName), req.body);
  const meeting: MorningMeeting = {
    id,
    title: String(req.query.title || "晨会").trim().slice(0, 200) || "晨会",
    meetingDate: String(req.query.meetingDate || now.slice(0, 10)).slice(0, 40),
    status: "uploaded",
    originalFileName,
    audioFileName,
    mimeType,
    fileSize: req.body.length,
    transcript: markdownTranscript,
    transcriptSegments: [],
    summary: "",
    speakers: [],
    tasks: [],
    errorMessage: "",
    createdBy: req.user!.id,
    teamId: req.user!.teamId,
    createdAt: now,
    updatedAt: now
  };
  getStore().morningMeetings.unshift(meeting);
  await getStore().persist();
  res.json({ meeting });
}));


app.get("/api/morning-meetings/:id/audio", requireAuth, (req, res) => {
  if (!assertMorningMeetingManager(req, res)) return;
  const meeting = findMorningMeeting(req, res);
  if (!meeting) return;
  const file = path.join(morningMeetingDirectory, path.basename(meeting.audioFileName));
  if (!meeting.audioFileName || !existsSync(file)) {
    res.status(404).json({ message: "录音文件不存在" });
    return;
  }
  res.type(meeting.mimeType || "application/octet-stream");
  res.sendFile(file);
});


app.delete("/api/morning-meetings/:id", requireAuth, asyncRoute(async (req, res) => {
  if (!assertMorningMeetingManager(req, res)) return;
  const meeting = findMorningMeeting(req, res);
  if (!meeting) return;
  if (meeting.status === "published") {
    res.status(409).json({ message: "已发布的晨会记录需要保留派发依据，不能删除" });
    return;
  }
  const store = getStore();
  store.morningMeetings.splice(store.morningMeetings.indexOf(meeting), 1);
  if (meeting.audioFileName) await rm(path.join(morningMeetingDirectory, path.basename(meeting.audioFileName)), { force: true });
  await store.persist();
  res.json({ ok: true });
}));


app.post("/api/morning-meetings/:id/analyze", requireAuth, asyncRoute(async (req, res) => {
  if (!assertMorningMeetingManager(req, res)) return;
  const meeting = findMorningMeeting(req, res);
  if (!meeting) return;
  const schema = z.object({ transcript: z.string().max(200_000).optional(), requireAi: z.boolean().optional().default(false) });
  const body = schema.parse(req.body || {});
  const transcriptionSettings = morningMeetingTranscriptionForTeam(req.user!.teamId);
  const config = getMorningMeetingAiConfig(req.user!, transcriptionSettings.aiConfigId);
  const aiConfig = config?.enabled && config.apiKey && config.baseUrl && config.model ? config : null;
  if (body.requireAi && !aiConfig) {
    res.status(409).json({ message: "没有可用的 AI 模型。请先在模型配置中保存可用配置，保存后会默认启用。" });
    return;
  }
  meeting.status = "processing";
  meeting.errorMessage = "";
  meeting.updatedAt = new Date().toISOString();
  await getStore().persist();
  let transcript = String(body.transcript || meeting.transcript || "").trim();
  try {
    if (body.transcript != null && body.transcript.trim() !== meeting.transcript.trim()) meeting.transcriptSegments = [];
    if (!transcript) {
      if (!transcriptionSettings.enabled) throw new Error("晨会录音识别尚未启用，请先到模型配置中开启");
      const file = path.join(morningMeetingDirectory, path.basename(meeting.audioFileName));
      if (!existsSync(file)) throw new Error("录音文件不存在，请重新上传");
      const audio = await readFile(file);
      if (transcriptionSettings.provider === "openai-compatible" && !aiConfig) {
        throw new Error("云端语音转写需要可用的 AI 配置；也可以改用本地 FunASR，无需配置 AI");
      }
      const transcription = transcriptionSettings.provider === "funasr-local"
        ? await callLocalFunAsr(transcriptionSettings.baseUrl, audio, meeting.originalFileName, meeting.mimeType, { model: transcriptionSettings.model, diarization: transcriptionSettings.diarization })
        : await callAiAudioTranscription(aiConfig!, audio, meeting.originalFileName, meeting.mimeType, { model: transcriptionSettings.model, diarization: transcriptionSettings.diarization });
      const speakerNumbers = new Map<string, number>();
      meeting.transcriptSegments = transcription.segments.map((item) => {
        const source = item.speaker || "default";
        if (!speakerNumbers.has(source)) speakerNumbers.set(source, speakerNumbers.size + 1);
        return { speaker: source, speakerLabel: `发言人${speakerNumbers.get(source)}`, start: item.start || 0, end: item.end || item.start || 0, text: item.text };
      });
      const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
      transcript = meeting.transcriptSegments.length
        ? meeting.transcriptSegments.map((item) => `[${clock(item.start)}–${clock(item.end)}] ${item.speakerLabel}：${item.text}`).join("\n")
        : transcription.text;
    }
    // 本地转写一完成就先落库。后续 AI 整理即使超时，也不能丢失已经得到的文字和时间段。
    meeting.transcript = transcript;
    meeting.updatedAt = new Date().toISOString();
    await getStore().persist();
    if (!aiConfig) {
      const labels = [...new Set((meeting.transcriptSegments || []).map((item) => item.speakerLabel).filter(Boolean))];
      if (!labels.length && transcript) labels.push("发言人1");
      meeting.transcript = transcript;
      meeting.summary = "";
      meeting.speakers = labels.map((label) => ({ label, assigneeId: "", ignored: false }));
      meeting.tasks = [];
      meeting.status = "review";
      meeting.errorMessage = "";
      meeting.updatedAt = new Date().toISOString();
      await getStore().persist();
      res.json({
        meeting,
        analysisMode: "transcription-only",
        message: "录音转写已完成；当前未配置摘要模型，可直接核对文字并手动填写摘要和待办"
      });
      return;
    }
    const prompt = `你是华源CRM的会议 Agent。只能依据转写内容提取明确安排，不得补造姓名、客户、金额或承诺。\n
会议日期：${meeting.meetingDate}\n
请只返回 JSON：{"summary":"会议摘要","speakers":[{"label":"发言人1"}],"tasks":[{"speakerLabel":"发言人1","title":"具体可执行任务","description":"任务细节和验收标准","dueAt":"YYYY-MM-DD HH:mm","priority":"high|medium|normal","sourceExcerpt":"原文依据","confidence":0.9}]}。\n
即使原文出现姓名，也统一用发言人1、发言人2编号；按首次出现顺序编号。没有明确截止时间时 dueAt 留空，没有明确任务时 tasks 返回空数组。\n
转写内容：\n${transcript.slice(0, 60_000)}`;
    const parsed = extractJsonObject(await callAiModel(aiConfig, prompt, 65_000, undefined, 10 * 60_000)) as Record<string, unknown> | null;
    if (!parsed) throw new Error("AI 未返回可识别的任务结构");
    const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
    const labelOrder: string[] = [];
    const normalizeLabel = (value: unknown) => {
      const matched = String(value || "").match(/(?:发言人|speaker)\s*(\d+)/iu);
      const label = `发言人${matched?.[1] || labelOrder.length + 1}`;
      if (!labelOrder.includes(label)) labelOrder.push(label);
      return label;
    };
    if (Array.isArray(parsed.speakers)) {
      for (const item of parsed.speakers) normalizeLabel(typeof item === "object" && item ? (item as Record<string, unknown>).label : item);
    }
    const tasks: MorningMeetingTaskDraft[] = rawTasks.slice(0, 100).map((item, index) => {
      const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const priority = ["high", "medium", "normal"].includes(String(row.priority)) ? String(row.priority) as MorningMeetingTaskDraft["priority"] : "normal";
      return {
        id: `mmt_${randomUUID()}`,
        speakerLabel: normalizeLabel(row.speakerLabel),
        title: String(row.title || `晨会待办${index + 1}`).trim().slice(0, 255),
        description: String(row.description || "").trim().slice(0, 2000),
        dueAt: String(row.dueAt || "").trim().slice(0, 100),
        priority,
        sourceExcerpt: String(row.sourceExcerpt || "").trim().slice(0, 500),
        confidence: Math.max(0, Math.min(1, Number(row.confidence) || 0)),
        status: "draft"
      };
    });
    if (!labelOrder.length && transcript) labelOrder.push("发言人1");
    meeting.transcript = transcript;
    meeting.summary = String(parsed.summary || "").trim().slice(0, 4000);
    meeting.speakers = labelOrder.map((label) => ({ label, assigneeId: "", ignored: false }));
    meeting.tasks = tasks;
    meeting.status = "review";
    meeting.updatedAt = new Date().toISOString();
    await getStore().persist();
    res.json({ meeting });
  } catch (error) {
    const upstreamStatus = typeof error === "object" && error && "httpStatus" in error ? Number(error.httpStatus) : 0;
    const upstreamMessage = typeof error === "object" && error && "upstreamMessage" in error ? String(error.upstreamMessage || "") : "";
    const aborted = error instanceof Error && (error.name === "AbortError" || /aborted|abort|timeout|timed out/iu.test(error.message));
    const failureMessage = upstreamStatus === 404
      ? "当前上游只支持文本模型，没有 /audio/transcriptions 语音转写接口。请改用支持录音转写的服务，或上传 Markdown 文字稿。"
      : aborted
        ? "AI 整理等待超时，但录音转写文字已经保存。可在待办草稿中点击“调用 AI 解析”继续重试，无需重新上传录音。"
      : upstreamStatus
        ? `语音转写失败（HTTP ${upstreamStatus}）${upstreamMessage ? `：${upstreamMessage}` : ""}`
        : error instanceof Error ? error.message : "晨会解析失败";
    meeting.errorMessage = failureMessage.slice(0, 1000);
    const hasTranscript = Boolean((transcript || meeting.transcript).trim());
    meeting.status = hasTranscript ? "review" : "failed";
    if (hasTranscript && !meeting.speakers.length) {
      const labels = [...new Set((meeting.transcriptSegments || []).map((item) => item.speakerLabel).filter(Boolean))];
      meeting.speakers = (labels.length ? labels : ["发言人1"]).map((label) => ({ label, assigneeId: "", ignored: false }));
    }
    meeting.updatedAt = new Date().toISOString();
    await getStore().persist();
    if (hasTranscript && !body.requireAi) {
      res.json({ meeting, analysisMode: "transcription-only", message: failureMessage });
      return;
    }
    res.status(upstreamStatus >= 400 && upstreamStatus < 500 ? 409 : 502).json({ message: meeting.errorMessage, meeting });
  }
}));


app.patch("/api/morning-meetings/:id/review", requireAuth, asyncRoute(async (req, res) => {
  if (!assertMorningMeetingManager(req, res)) return;
  const meeting = findMorningMeeting(req, res);
  if (!meeting) return;
  if (meeting.status === "published") {
    res.status(409).json({ message: "该晨会记录已经发布，不能再修改" });
    return;
  }
  const speakerSchema = z.object({ label: z.string().min(1).max(40), assigneeId: z.string().max(64).default(""), ignored: z.boolean().default(false) });
  const taskSchema = z.object({
    id: z.string().min(1).max(80), speakerLabel: z.string().min(1).max(40), title: z.string().min(1).max(255),
    description: z.string().max(2000).default(""), dueAt: z.string().max(100).default(""),
    priority: z.enum(["high", "medium", "normal"]).default("normal"), sourceExcerpt: z.string().max(500).default(""),
    confidence: z.number().min(0).max(1).default(0), status: z.enum(["draft", "ignored"]).default("draft"), assigneeId: z.string().max(64).optional()
  });
  const body = z.object({ transcript: z.string().max(200_000).optional(), summary: z.string().max(4000).optional(), speakers: z.array(speakerSchema).max(50), tasks: z.array(taskSchema).max(100) }).parse(req.body);
  const validIds = new Set(morningMeetingMembers(req.user!).map((item) => item.id));
  if (body.speakers.some((item) => item.assigneeId && !validIds.has(item.assigneeId)) || body.tasks.some((item) => item.assigneeId && !validIds.has(item.assigneeId))) {
    res.status(400).json({ message: "选择的员工账号无效或不在当前团队" });
    return;
  }
  if (body.transcript != null && body.transcript !== meeting.transcript) meeting.transcriptSegments = [];
  meeting.transcript = body.transcript ?? meeting.transcript;
  meeting.summary = body.summary ?? meeting.summary;
  meeting.speakers = body.speakers;
  meeting.tasks = body.tasks;
  meeting.status = "review";
  meeting.updatedAt = new Date().toISOString();
  await getStore().persist();
  res.json({ meeting });
}));


app.post("/api/morning-meetings/:id/publish", requireAuth, asyncRoute(async (req, res) => {
  if (!assertMorningMeetingManager(req, res)) return;
  const meeting = findMorningMeeting(req, res);
  if (!meeting) return;
  const store = getStore();
  const validIds = new Set(morningMeetingMembers(req.user!).map((item) => item.id));
  const mappings = new Map(meeting.speakers.filter((item) => !item.ignored).map((item) => [item.label, item.assigneeId]));
  const publishable = meeting.tasks.filter((item) => item.status !== "ignored");
  const missing = publishable.filter((item) => !validIds.has(item.assigneeId || mappings.get(item.speakerLabel) || ""));
  if (!publishable.length) {
    res.status(400).json({ message: "没有可发布的待办任务" });
    return;
  }
  if (missing.length) {
    res.status(400).json({ message: `还有 ${missing.length} 项任务未绑定员工账号` });
    return;
  }
  for (const task of publishable) {
    const ownerId = task.assigneeId || mappings.get(task.speakerLabel)!;
    const triggerKey = `morning-meeting:${meeting.id}:${task.id}`;
    let todo = store.todos.find((item) => item.triggerKey === triggerKey);
    if (!todo) {
      todo = {
        id: `t_${randomUUID()}`,
        title: task.title,
        type: "other",
        priority: task.priority,
        dueAt: task.dueAt,
        ownerId,
        teamId: meeting.teamId,
        related: `晨会：${meeting.title}${task.description ? ` · ${task.description}` : ""}`.slice(0, 200),
        done: false,
        status: "pending",
        pinState: "",
        sortOrder: nextTodoSortOrder(store.todos, ownerId),
        triggerKey,
        createdAt: new Date().toISOString()
      };
      store.todos.unshift(todo);
    }
    task.status = "published";
    task.assigneeId = ownerId;
    task.todoId = todo.id;
  }
  meeting.status = "published";
  meeting.publishedAt = new Date().toISOString();
  meeting.publishedBy = req.user!.id;
  meeting.updatedAt = meeting.publishedAt;
  await store.persist();
  res.json({ meeting, publishedCount: publishable.length });
}));


function getMorningMeetingAiConfig(user: SessionUser, aiConfigId = "") {
  const configs = getAiConfigs(user);
  const selected = aiConfigId ? configs.find((item) => item.id === aiConfigId) : undefined;
  return selected || getAiConfig(user, "emailDraft");
}