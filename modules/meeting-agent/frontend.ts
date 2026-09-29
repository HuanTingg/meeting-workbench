interface MorningMeetingMember { id: string; name: string; role: string; teamId: string }
interface MorningMeetingSpeaker { label: string; assigneeId: string; ignored: boolean }
interface MorningMeetingTask {
  id: string; speakerLabel: string; title: string; description: string; dueAt: string;
  priority: "high" | "medium" | "normal"; sourceExcerpt: string; confidence: number;
  status: "draft" | "published" | "ignored"; assigneeId?: string; todoId?: string;
}
interface MorningMeeting {
  id: string; title: string; meetingDate: string; status: "uploaded" | "processing" | "review" | "published" | "failed";
  originalFileName: string; audioFileName: string; mimeType: string; fileSize: number; transcript: string; transcriptSegments?: Array<{ speaker: string; speakerLabel: string; start: number; end: number; text: string }>; summary: string;
  speakers: MorningMeetingSpeaker[]; tasks: MorningMeetingTask[]; errorMessage: string; createdBy: string; teamId: string;
  createdAt: string; updatedAt: string; publishedAt?: string; publishedBy?: string;
}

let morningMeetings: MorningMeeting[] = [];
let morningMeetingMembers: MorningMeetingMember[] = [];
const morningMeetingProgress = new Map<string, number>();

function morningMeetingStatus(status: MorningMeeting["status"]) {
  return ({ uploaded: "等待解析", processing: "正在解析", review: "待负责人确认", published: "已发布", failed: "解析失败" } as const)[status];
}

function morningMeetingErrorMessage(meeting: MorningMeeting) {
  if (/AI 模型 HTTP 404|404 page not found/iu.test(meeting.errorMessage || "")) {
    return "当前上游只支持文本模型，没有语音转写接口。请改用支持录音转写的服务，或上传 Markdown 文字稿。";
  }
  if (/AI request timeout|operation was aborted|aborted/iu.test(meeting.errorMessage || "")) {
    return "AI 整理等待超时，但录音转写文字已经保存。可打开审核页面并点击“调用 AI 解析”重试，无需重新上传。";
  }
  return meeting.errorMessage || "";
}

function renderMorningMeetings() {
  const host = qs<HTMLElement>("#morningMeetingRows");
  if (!host) return;
  if (!morningMeetings.length) {
    host.innerHTML = '<div class="morning-meeting-empty">暂无晨会记录。上传录音或 Markdown 文字稿后，AI 会先生成草稿，不会直接发布给员工。</div>';
    return;
  }
  host.innerHTML = morningMeetings.map((meeting) => `
    <div class="morning-meeting-row">
      <div><b>${escapeHtml(meeting.title)}</b><small>${escapeHtml(meeting.meetingDate)} · ${escapeHtml(meeting.originalFileName || "手工转写")}</small>${meeting.status === "failed" && morningMeetingErrorMessage(meeting) ? `<small class="morning-meeting-error" title="${escapeHtml(morningMeetingErrorMessage(meeting))}">${escapeHtml(morningMeetingErrorMessage(meeting))}</small>` : ""}</div>
      ${meeting.status === "processing" ? (() => { const progress = morningMeetingProgress.get(meeting.id) || 5; const stage = progress < 70 ? "正在转写录音" : progress < 90 ? "正在识别发言人" : "正在调用 AI 整理待办"; return `<div class="morning-analysis-progress" style="--morning-progress:${progress}%"><span>${stage} ${progress}%</span><i></i></div>`; })() : `<span class="morning-status ${meeting.status}">${morningMeetingStatus(meeting.status)}</span>`}
      <span>${meeting.speakers.length} 位</span><span>${meeting.tasks.filter((item) => item.status !== "ignored").length} 项</span>
      <div class="morning-meeting-actions">
        ${meeting.status === "uploaded" || meeting.status === "failed" ? `<button class="btn" data-morning-analyze="${meeting.id}">开始解析</button>` : ""}
        <button class="btn ${meeting.status === "review" ? "primary" : ""}" data-morning-review="${meeting.id}">${meeting.status === "published" ? "查看" : "审核发布"}</button>
        ${meeting.status !== "published" ? `<button class="btn" data-morning-delete="${meeting.id}">删除</button>` : ""}
      </div>
    </div>`).join("");
  qsa<HTMLButtonElement>("[data-morning-analyze]", host).forEach((button) => button.addEventListener("click", () => void analyzeMorningMeeting(button.dataset.morningAnalyze || "")));
  qsa<HTMLButtonElement>("[data-morning-review]", host).forEach((button) => button.addEventListener("click", () => openMorningMeetingReview(button.dataset.morningReview || "")));
  qsa<HTMLButtonElement>("[data-morning-delete]", host).forEach((button) => button.addEventListener("click", () => void (async () => {
    const id = button.dataset.morningDelete || "";
    if (!window.confirm("删除这条未发布的晨会记录和源文件？")) return;
    try { await api(`/api/morning-meetings/${encodeURIComponent(id)}`, { method: "DELETE" }); morningMeetings = morningMeetings.filter((item) => item.id !== id); renderMorningMeetings(); toast("晨会记录已删除", "success"); }
    catch (error) { toast(error instanceof Error ? error.message : "删除失败", "error"); }
  })()));
}

async function loadMorningMeetings() {
  try {
    const data = await api<{ meetings: MorningMeeting[]; members: MorningMeetingMember[] }>("/api/morning-meetings");
    morningMeetings = data.meetings;
    morningMeetingMembers = data.members;
    renderMorningMeetings();
  } catch (error) {
    toast(error instanceof Error ? error.message : "会议 Agent 加载失败", "error");
  }
}

function openMorningMeetingUpload() {
  const today = new Date().toISOString().slice(0, 10);
  openModal("上传晨会资料", `<div class="form-grid">
    <div class="form-field"><label>会议日期</label><input id="morningMeetingDate" type="date" value="${today}"></div>
    <div class="form-field"><label>会议标题</label><input id="morningMeetingTitle" maxlength="200" value="${today} 晨会"></div>
    <div class="form-field full"><label>录音或文字稿</label><input id="morningMeetingFile" type="file" accept="audio/*,.mp3,.m4a,.aac,.amr,.3gp,.wav,.webm,.ogg,.mp4,.md,text/markdown"></div>
    <div class="form-field full"><div class="morning-review-help">支持晨会录音和 .md 文字稿。录音由本地 FunASR 转写，无需先配置 AI；有可用 AI 时会继续提取摘要与待办，没有时也能查看转写并手动整理。上传后均先形成待审核草稿，不会直接给员工派发任务。</div></div>
  </div>`, '<button class="btn" data-modal-close>取消</button><button class="btn primary" id="morningMeetingUploadConfirm">上传并解析</button>');
  qs<HTMLButtonElement>("#morningMeetingUploadConfirm")?.addEventListener("click", () => void (async () => {
    const file = qs<HTMLInputElement>("#morningMeetingFile")?.files?.[0];
    if (!file) { toast("请选择录音或 Markdown 文字稿", "error"); return; }
    const button = qs<HTMLButtonElement>("#morningMeetingUploadConfirm")!;
    button.disabled = true; button.textContent = "上传中…";
    try {
      const title = qs<HTMLInputElement>("#morningMeetingTitle")?.value.trim() || "晨会";
      const date = qs<HTMLInputElement>("#morningMeetingDate")?.value || today;
      const params = new URLSearchParams({ title, meetingDate: date, fileName: file.name });
      const uploaded = await api<{ meeting: MorningMeeting }>(`/api/morning-meetings/upload?${params}`, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
      closeModal();
      morningMeetings.unshift(uploaded.meeting); renderMorningMeetings();
      toast(/\.md$/iu.test(file.name) ? "文字稿上传成功，正在整理内容" : "录音上传成功，正在进行本地转写", "success");
      await analyzeMorningMeeting(uploaded.meeting.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : "晨会资料上传失败", "error");
      button.disabled = false; button.textContent = "上传并解析";
    }
  })());
}

async function analyzeMorningMeeting(id: string, transcript?: string, requireAi = false) {
  const meeting = morningMeetings.find((item) => item.id === id);
  morningMeetingProgress.set(id, transcript ? 72 : 5);
  if (meeting) { meeting.status = "processing"; renderMorningMeetings(); }
  const progressTimer = window.setInterval(() => {
    const current = morningMeetingProgress.get(id) || 5;
    morningMeetingProgress.set(id, Math.min(97, current + (current < 55 ? 4 : current < 82 ? 2 : 1)));
    renderMorningMeetings();
  }, 2_500);
  try {
    const data = await api<{ meeting: MorningMeeting; analysisMode?: "ai" | "transcription-only"; message?: string }>(`/api/morning-meetings/${encodeURIComponent(id)}/analyze`, { method: "POST", body: JSON.stringify({ ...(transcript == null ? {} : { transcript }), requireAi }) });
    window.clearInterval(progressTimer);
    morningMeetingProgress.set(id, 100);
    morningMeetings = morningMeetings.map((item) => item.id === id ? data.meeting : item);
    renderMorningMeetings();
    morningMeetingProgress.delete(id);
    openMorningMeetingReview(id);
    toast(data.message || "AI 解析完成，请核对发言人与待办", "success");
  } catch (error) {
    window.clearInterval(progressTimer);
    morningMeetingProgress.delete(id);
    await loadMorningMeetings();
    toast(error instanceof Error ? error.message : "晨会解析失败", "error");
  }
}

function openMorningMeetingReview(id: string) {
  const meeting = morningMeetings.find((item) => item.id === id);
  if (!meeting) return;
  const readonly = meeting.status === "published";
  const memberOptions = (selected = "", emptyLabel = "请选择员工账号") => `<option value="">${escapeHtml(emptyLabel)}</option>${morningMeetingMembers.map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name)} · ${escapeHtml(roleLabel[item.role as Role] || item.role)}</option>`).join("")}`;
  const memberName = (memberId = "") => morningMeetingMembers.find((item) => item.id === memberId)?.name || "";
  const speakers = meeting.speakers.map((speaker, index) => `<div class="morning-speaker-row" data-morning-speaker="${escapeHtml(speaker.label)}"><b>${escapeHtml(speaker.label)}</b><label class="morning-field"><span>员工账号</span><select data-speaker-assignee ${readonly ? "disabled" : ""}>${memberOptions(speaker.assigneeId)}</select></label><label class="morning-field"><span>统一截止时间</span><input type="datetime-local" data-speaker-due aria-label="${escapeHtml(speaker.label)}统一截止时间" ${readonly ? "disabled" : ""}><small>应用到该发言人的全部待办，可在下方单独调整</small></label><label class="morning-check morning-ignore-help"><input type="checkbox" data-ignore aria-describedby="morningIgnoreHelp${index}" ${speaker.ignored ? "checked" : ""} ${readonly ? "disabled" : ""}> 不派发<span class="morning-tooltip" id="morningIgnoreHelp${index}" role="tooltip">勾选后，发布时跳过该发言人的全部待办，不向员工派发；其他发言人不受影响。</span></label></div>`).join("") || '<div class="morning-review-help">转写中尚未识别到发言人。可修改下方转写文本后重新解析。</div>';
  const tasks = meeting.tasks.map((task, index) => {
    const speakerOwnerId = meeting.speakers.find((speaker) => speaker.label === task.speakerLabel)?.assigneeId || "";
    const assigneeId = task.assigneeId || speakerOwnerId;
    const ownerName = memberName(assigneeId) || task.speakerLabel;
    return `<div class="morning-task-row" data-morning-task="${task.id}" data-morning-speaker-label="${escapeHtml(task.speakerLabel)}">
    <div class="morning-task-head"><b>待办 ${String(index + 1).padStart(2, "0")}</b><label class="morning-check"><input type="checkbox" data-task-ignore ${task.status === "ignored" ? "checked" : ""} ${readonly ? "disabled" : ""}> 忽略此待办</label></div>
    <label class="morning-field"><span>负责人</span><select data-field="assigneeId" data-follow-speaker="${task.assigneeId ? "false" : "true"}" ${readonly ? "disabled" : ""}>${memberOptions(assigneeId, "请选择负责人")}</select></label>
    <label class="morning-field"><span>截止时间</span><input data-field="dueAt" type="datetime-local" value="${escapeHtml(task.dueAt.replace(" ", "T").slice(0, 16))}" ${readonly ? "disabled" : ""}></label>
    <label class="morning-field"><span>优先级</span><select data-field="priority" ${readonly ? "disabled" : ""}><option value="high" ${task.priority === "high" ? "selected" : ""}>高</option><option value="medium" ${task.priority === "medium" ? "selected" : ""}>中</option><option value="normal" ${task.priority === "normal" ? "selected" : ""}>普通</option></select></label>
    <label class="morning-field morning-task-title"><span>待办标题</span><textarea data-field="title" maxlength="255" rows="2" ${readonly ? "disabled" : ""}>${escapeHtml(task.title)}</textarea></label>
    <label class="morning-field morning-task-description"><span>任务说明</span><textarea data-field="description" maxlength="2000" rows="2" placeholder="补充执行要求与完成标准" ${readonly ? "disabled" : ""}>${escapeHtml(task.description)}</textarea></label>
    <p class="morning-task-source"><b>原文依据 · <span data-task-owner-name>${escapeHtml(ownerName)}</span></b>${escapeHtml(task.sourceExcerpt || "无原文摘录")}</p>
  </div>`;
  }).join("") || (readonly
    ? '<div class="morning-review-help">AI 没有提取到明确待办。</div>'
    : '<div class="morning-review-help morning-empty-tasks"><span>AI 没有提取到明确待办。可修改转写内容后直接调用 AI，不需要重新上传录音。</span><button class="btn primary" id="morningCallAi" type="button">调用 AI 解析</button></div>');
  const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const timedTranscript = (meeting.transcriptSegments || []).map((item) => `<button class="morning-transcript-segment" type="button" data-morning-seek="${item.start}"><time>${clock(item.start)}–${clock(item.end)}</time><b>${escapeHtml(item.speakerLabel)}</b><span>${escapeHtml(item.text)}</span></button>`).join("");
  const audioPlayer = meeting.audioFileName && !/\.md$/iu.test(meeting.originalFileName) ? `<audio id="morningAudioPlayer" controls preload="metadata" src="/api/morning-meetings/${encodeURIComponent(meeting.id)}/audio"></audio>` : "";
  openModal(readonly ? `查看会议 Agent · ${meeting.title}` : `审核会议 Agent · ${meeting.title}`, `<div class="morning-review">
    ${meeting.errorMessage ? `<div class="morning-review-help">上次解析失败：${escapeHtml(meeting.errorMessage)}</div>` : ""}
    ${audioPlayer || timedTranscript ? `<div class="morning-review-section morning-audio-review"><h3>录音与时间定位</h3>${audioPlayer}${timedTranscript ? `<div class="morning-transcript-segments">${timedTranscript}</div>` : `<div class="morning-review-help">当前记录没有时间段信息，重新解析后可按时间定位。</div>`}</div>` : ""}
    <div class="morning-review-section"><h3>会议摘要</h3><textarea id="morningSummary" ${readonly ? "disabled" : ""}>${escapeHtml(meeting.summary)}</textarea></div>
    <div class="morning-review-section"><h3>发言人与员工账号</h3><div class="morning-review-help">在这里绑定实际员工后，对应待办会自动显示并选择该员工；每条待办仍可单独改派给其他人。</div>${speakers}</div>
    <div class="morning-review-section"><h3>待办草稿</h3>${tasks}</div>
    <details><summary>查看或修正转写文本</summary><textarea id="morningTranscript" ${readonly ? "disabled" : ""}>${escapeHtml(meeting.transcript)}</textarea></details>
  </div>`, readonly ? '<button class="btn" data-modal-close>关闭</button>' : '<button class="btn" data-modal-close>取消</button><button class="btn" id="morningReanalyze">按修正文本重新解析</button><button class="btn primary" id="morningPublish">确认并发布待办</button>');
  qs<HTMLElement>("#appModal .modal")?.classList.add("agent-memory-modal");
  const speakerRows = qsa<HTMLElement>("#appModal [data-morning-speaker]");
  const taskRows = qsa<HTMLElement>("#appModal [data-morning-task]");
  const tasksForSpeaker = (label: string) => taskRows.filter((row) => row.dataset.morningSpeakerLabel === label);
  const syncSpeakerDeadlines = () => speakerRows.forEach((row) => {
    const dates = tasksForSpeaker(row.dataset.morningSpeaker || "").map((task) => task.querySelector<HTMLInputElement>('[data-field="dueAt"]')!.value);
    row.querySelector<HTMLInputElement>("[data-speaker-due]")!.value = dates.length && dates.every((date) => date === dates[0]) ? dates[0] : "";
  });
  syncSpeakerDeadlines();
  if (readonly) return;
  const syncTaskOwnerName = (row: HTMLElement) => {
    const assigneeId = row.querySelector<HTMLSelectElement>('[data-field="assigneeId"]')?.value || "";
    const label = row.querySelector<HTMLElement>("[data-task-owner-name]");
    if (label) label.textContent = memberName(assigneeId) || row.dataset.morningSpeakerLabel || "未指定";
  };
  speakerRows.forEach((row) => row.querySelector<HTMLSelectElement>("[data-speaker-assignee]")!.addEventListener("change", (event) => {
    const assigneeId = (event.currentTarget as HTMLSelectElement).value;
    tasksForSpeaker(row.dataset.morningSpeaker || "").forEach((task) => {
      const taskAssignee = task.querySelector<HTMLSelectElement>('[data-field="assigneeId"]')!;
      if (taskAssignee.dataset.followSpeaker !== "false") taskAssignee.value = assigneeId;
      syncTaskOwnerName(task);
    });
  }));
  speakerRows.forEach((row) => row.querySelector<HTMLInputElement>("[data-speaker-due]")!.addEventListener("change", (event) => {
    const dueAt = (event.currentTarget as HTMLInputElement).value;
    tasksForSpeaker(row.dataset.morningSpeaker || "").forEach((task) => {
      task.querySelector<HTMLInputElement>('[data-field="dueAt"]')!.value = dueAt;
    });
  }));
  taskRows.forEach((row) => {
    row.querySelector('[data-field="dueAt"]')?.addEventListener("change", syncSpeakerDeadlines);
    row.querySelector<HTMLSelectElement>('[data-field="assigneeId"]')?.addEventListener("change", (event) => {
      (event.currentTarget as HTMLSelectElement).dataset.followSpeaker = "false";
      syncTaskOwnerName(row);
    });
  });
  const collect = () => {
    const speakers: MorningMeetingSpeaker[] = qsa<HTMLElement>("[data-morning-speaker]").map((row) => ({ label: row.dataset.morningSpeaker || "", assigneeId: row.querySelector<HTMLSelectElement>("[data-speaker-assignee]")?.value || "", ignored: Boolean(row.querySelector<HTMLInputElement>("[data-ignore]")?.checked) }));
    const tasks: MorningMeetingTask[] = qsa<HTMLElement>("[data-morning-task]").map((row) => {
      const original = meeting.tasks.find((item) => item.id === row.dataset.morningTask)!;
      const value = (field: string) => row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${field}"]`)?.value || "";
      return { ...original, speakerLabel: row.dataset.morningSpeakerLabel || original.speakerLabel, assigneeId: value("assigneeId"), title: value("title").trim(), description: value("description").trim(), dueAt: value("dueAt").replace("T", " "), priority: value("priority") as MorningMeetingTask["priority"], status: row.querySelector<HTMLInputElement>("[data-task-ignore]")?.checked ? "ignored" : "draft" };
    });
    return { transcript: qs<HTMLTextAreaElement>("#morningTranscript")?.value || "", summary: qs<HTMLTextAreaElement>("#morningSummary")?.value || "", speakers, tasks };
  };
  const callAiAgain = () => { const draft = collect(); closeModal(); void analyzeMorningMeeting(id, draft.transcript, true); };
  qs<HTMLButtonElement>("#morningCallAi")?.addEventListener("click", callAiAgain);
  qs<HTMLButtonElement>("#morningReanalyze")?.addEventListener("click", callAiAgain);
  qs<HTMLButtonElement>("#morningPublish")?.addEventListener("click", () => void (async () => {
    const button = qs<HTMLButtonElement>("#morningPublish")!; button.disabled = true; button.textContent = "发布中…";
    try {
      const saved = await api<{ meeting: MorningMeeting }>(`/api/morning-meetings/${encodeURIComponent(id)}/review`, { method: "PATCH", body: JSON.stringify(collect()) });
      const published = await api<{ meeting: MorningMeeting; publishedCount: number }>(`/api/morning-meetings/${encodeURIComponent(id)}/publish`, { method: "POST", body: "{}" });
      morningMeetings = morningMeetings.map((item) => item.id === id ? published.meeting : item);
      closeModal(); renderMorningMeetings();
      const todoData = await api<{ todos: Todo[] }>("/api/todos"); state.todos = todoData.todos; renderTodos(state.todos); renderTopbarStats();
      toast(`已向对应员工发布 ${published.publishedCount} 项待办`, "success");
      void saved;
    } catch (error) {
      toast(error instanceof Error ? error.message : "待办发布失败", "error"); button.disabled = false; button.textContent = "确认并发布待办";
    }
  })());
}

