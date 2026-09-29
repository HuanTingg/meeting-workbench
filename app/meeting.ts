interface MorningMeetingMember { id: string; name: string; department: string }
interface MorningMeetingSpeaker { label: string; assigneeId: string; ignored: boolean }
interface MorningMeetingTask {
  id: string; speakerLabel: string; title: string; description: string; dueAt: string;
  priority: "high" | "medium" | "normal"; sourceExcerpt: string; confidence: number;
  status: "draft" | "published" | "ignored"; assigneeId?: string; todoId?: string;
}
interface MorningMeeting {
  id: string; title: string; meetingDate: string; status: "uploaded" | "processing" | "review" | "published" | "failed";
  uploadedBy?: string;
  originalFileName: string; audioFileName: string; mimeType: string; fileSize: number; transcript: string; transcriptSegments?: Array<{ speaker: string; speakerLabel: string; start: number; end: number; text: string }>; summary: string;
  speakers: MorningMeetingSpeaker[]; tasks: MorningMeetingTask[]; errorMessage: string; createdBy: string; teamId: string;
  createdAt: string; updatedAt: string; publishedAt?: string; publishedBy?: string;
}

let morningMeetings: MorningMeeting[] = [];
let morningMeetingMembers: MorningMeetingMember[] = [];
const morningWaitStarted = new Map<string, number>();
let morningProgressTimer: ReturnType<typeof setInterval> | undefined;
let morningProgressPolling = false;
let morningProgressTicks = 0;

function syncMorningProgress() {
  const processing = morningMeetings.filter(m => m.status === "processing");
  for (const id of morningWaitStarted.keys()) if (!processing.some(m => m.id === id)) morningWaitStarted.delete(id);
  for (const m of processing) if (!morningWaitStarted.has(m.id)) morningWaitStarted.set(m.id, Date.now());
  if (!processing.length) {
    if (morningProgressTimer) clearInterval(morningProgressTimer);
    morningProgressTimer = undefined;
    return;
  }
  if (morningProgressTimer) return;
  morningProgressTimer = setInterval(() => {
    qsa<HTMLElement>('[data-morning-elapsed]').forEach(el => {
      const seconds = Math.max(0, Math.floor((Date.now() - (morningWaitStarted.get(el.dataset.morningElapsed!) || Date.now())) / 1000));
      el.textContent = `本页已等待 ${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
    });
    if (++morningProgressTicks % 5 !== 0 || morningProgressPolling) return;
    morningProgressPolling = true;
    void (async () => {
      try {
        const ids = morningMeetings.filter(m => m.status === 'processing').map(m => m.id);
        for (const id of ids) {
          const result = await api<{meeting: MorningMeeting}>(`/api/morning-meetings/${encodeURIComponent(id)}`, {signal: AbortSignal.timeout(10000)});
          // A completed POST or a new UI action may have changed the row during the poll.
          if (morningMeetings.find(m => m.id === id)?.status !== 'processing') continue;
          morningMeetings = morningMeetings.map(m => m.id === id ? result.meeting : m);
        }
        renderMorningMeetings();
      } catch {
        qsa<HTMLElement>('[data-morning-progress-hint]').forEach(el => el.textContent = '状态同步暂时失败，正在重试；不代表处理已停止。');
      } finally { morningProgressPolling = false; }
    })();
  }, 1000);
}


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
  syncMorningProgress();
  const host = qs<HTMLElement>("#morningMeetingRows");
  if (!host) return;
  if (!morningMeetings.length) {
    host.innerHTML = '<div class="morning-meeting-empty">暂无会议记录。上传录音或 Markdown 文字稿后，AI 会先生成草稿，不会直接发布给成员。</div>';
    return;
  }
  host.innerHTML = morningMeetings.map((meeting) => `
    <div class="morning-meeting-row">
      <div><b>${escapeHtml(meeting.title)}</b><small>${escapeHtml(meeting.meetingDate)} · ${escapeHtml(meeting.originalFileName || "手工转写")}</small>${meeting.status === "failed" && morningMeetingErrorMessage(meeting) ? `<small class="morning-meeting-error" title="${escapeHtml(morningMeetingErrorMessage(meeting))}">${escapeHtml(morningMeetingErrorMessage(meeting))}</small>` : ""}</div>
      ${meeting.status === "processing" ? `<div class="morning-progress" aria-busy="true"><span class="morning-status processing">正在转写 / AI 解析…</span><div class="morning-progress-track" role="progressbar" aria-label="会议转写与解析处理中，暂无百分比"><i></i></div><small data-morning-elapsed="${meeting.id}">本页已等待 ${Math.floor((Date.now() - (morningWaitStarted.get(meeting.id) || Date.now())) / 60000)} 分 ${String(Math.floor((Date.now() - (morningWaitStarted.get(meeting.id) || Date.now())) / 1000) % 60).padStart(2, '0')} 秒</small><small data-morning-progress-hint>长录音可能需要数分钟，状态自动更新。</small></div>` : `<span class="morning-status ${meeting.status}">${morningMeetingStatus(meeting.status)}</span>`}
      <span>${meeting.speakers.length} 位</span><span>${meeting.tasks.filter((item) => item.status !== "ignored").length} 项</span>
      <div class="morning-meeting-actions">
        ${(currentUser?.role === "manager" || meeting.uploadedBy === currentUser?.memberId) && (meeting.status === "uploaded" || meeting.status === "failed") ? `<button class="btn" data-morning-analyze="${meeting.id}">开始解析</button>` : ""}
        <button ${meeting.status === "processing" ? "disabled" : ""} class="btn ${meeting.status === "review" ? "primary" : ""}" data-morning-review="${meeting.id}">${meeting.status === "published" || (currentUser?.role !== "manager" && meeting.uploadedBy !== currentUser?.memberId) ? "查看" : "审核发布"}</button>
        ${(currentUser?.role === "manager" || meeting.uploadedBy === currentUser?.memberId) && meeting.status !== "published" ? `<button class="btn" data-morning-delete="${meeting.id}">删除</button>` : ""}
      </div>
    </div>`).join("");
  qsa<HTMLButtonElement>("[data-morning-analyze]", host).forEach((button) => button.addEventListener("click", () => void analyzeMorningMeeting(button.dataset.morningAnalyze || "")));
  qsa<HTMLButtonElement>("[data-morning-review]", host).forEach((button) => button.addEventListener("click", () => openMorningMeetingReview(button.dataset.morningReview || "")));
  qsa<HTMLButtonElement>("[data-morning-delete]", host).forEach((button) => button.addEventListener("click", () => void (async () => {
    const id = button.dataset.morningDelete || "";
    if (!window.confirm("删除这条未发布的会议记录和源文件？")) return;
    try { await api(`/api/morning-meetings/${encodeURIComponent(id)}`, { method: "DELETE" }); morningMeetings = morningMeetings.filter((item) => item.id !== id); renderMorningMeetings(); toast("会议记录已删除", "success"); }
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
  const today = localDay();
  openModal("上传会议资料", `<div class="form-grid">
    <div class="form-field"><label>会议日期</label><input id="morningMeetingDate" type="date" value="${today}"></div>
    <div class="form-field"><label>会议标题</label><input id="morningMeetingTitle" maxlength="200" value="${today} 会议"></div>
    <div class="form-field full"><label>录音或文字稿</label><input id="morningMeetingFile" type="file" accept="audio/*,.txt,.mp3,.m4a,.aac,.amr,.3gp,.wav,.webm,.ogg,.mp4,.md,text/markdown"></div>
    <div class="form-field full"><div class="morning-review-help">支持会议录音和 .md 文字稿。录音由本地 FunASR 转写，无需先配置 AI；有可用 AI 时会继续提取摘要与待办，没有时也能查看转写并手动整理。上传后均先形成待审核草稿，不会直接给成员派发任务。</div></div>
  </div>`, '<button class="btn" data-modal-close>取消</button><button class="btn primary" id="morningMeetingUploadConfirm">上传并解析</button>');
  qs<HTMLButtonElement>("#morningMeetingUploadConfirm")?.addEventListener("click", () => void (async () => {
    const file = qs<HTMLInputElement>("#morningMeetingFile")?.files?.[0];
    if (!file) { toast("请选择录音或 Markdown 文字稿", "error"); return; }
    const button = qs<HTMLButtonElement>("#morningMeetingUploadConfirm")!;
    button.disabled = true; button.textContent = "上传中…";
    try {
      const title = qs<HTMLInputElement>("#morningMeetingTitle")?.value.trim() || "会议";
      const date = qs<HTMLInputElement>("#morningMeetingDate")?.value || today;
      const params = new URLSearchParams({ title, meetingDate: date, fileName: file.name });
      const uploaded = await api<{ meeting: MorningMeeting }>(`/api/morning-meetings/upload?${params}`, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
      closeModal();
      morningMeetings.unshift(uploaded.meeting); renderMorningMeetings();
      toast(/\.(md|txt)$/iu.test(file.name) ? "文字稿上传成功，正在整理内容" : "录音上传成功，正在进行本地转写", "success");
      await analyzeMorningMeeting(uploaded.meeting.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : "会议资料上传失败", "error");
      button.disabled = false; button.textContent = "上传并解析";
    }
  })());
}

async function analyzeMorningMeeting(id: string, transcript?: string, requireAi = false) {
  const meeting = morningMeetings.find((item) => item.id === id);
  if (meeting) { meeting.status = "processing"; renderMorningMeetings(); }
  try {
    const data = await api<{ meeting: MorningMeeting; analysisMode?: "ai" | "transcription-only"; message?: string }>(`/api/morning-meetings/${encodeURIComponent(id)}/analyze`, { method: "POST", body: JSON.stringify({ ...(transcript == null ? {} : { transcript }), requireAi }) });
    morningMeetings = morningMeetings.map((item) => item.id === id ? data.meeting : item);
    renderMorningMeetings();
    openMorningMeetingReview(id);
    toast(data.message || "AI 解析完成，请核对发言人与待办", "success");
  } catch (error) {
    await loadMorningMeetings();
    toast(error instanceof Error ? error.message : "会议解析失败", "error");
  }
}

function openMorningMeetingReview(id: string) {
  const meeting = morningMeetings.find((item) => item.id === id);
  if (!meeting) return;
  const readonly = (currentUser?.role !== "manager" && meeting.uploadedBy !== currentUser?.memberId) || meeting.status === "published" || meeting.status === "processing";
  const memberOptions = (selected = "", emptyLabel = "请选择成员") => `<option value="">${escapeHtml(emptyLabel)}</option>${morningMeetingMembers.map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name)}${item.department ? " · " + escapeHtml(item.department) : ""}</option>`).join("")}`;
  const memberName = (memberId = "") => morningMeetingMembers.find((item) => item.id === memberId)?.name || "";
  const speakers = meeting.speakers.map((speaker, index) => `<div class="morning-speaker-row" data-morning-speaker="${escapeHtml(speaker.label)}"><b>${escapeHtml(speaker.label)}</b><label class="morning-field"><span>成员</span><select data-speaker-assignee ${readonly ? "disabled" : ""}>${memberOptions(speaker.assigneeId)}</select></label><label class="morning-field"><span>统一截止时间</span><input type="datetime-local" data-speaker-due aria-label="${escapeHtml(speaker.label)}统一截止时间" ${readonly ? "disabled" : ""}><small>应用到该发言人的全部待办，可在下方单独调整</small></label><label class="morning-check morning-ignore-help"><input type="checkbox" data-ignore aria-describedby="morningIgnoreHelp${index}" ${speaker.ignored ? "checked" : ""} ${readonly ? "disabled" : ""}> 不派发<span class="morning-tooltip" id="morningIgnoreHelp${index}" role="tooltip">勾选后，发布时跳过该发言人的全部待办，不向成员派发；其他发言人不受影响。</span></label></div>`).join("") || '<div class="morning-review-help">暂无可绑定的发言人。录音转写有说话人分段时会自动列出；纯文字稿可注明发言人后使用 AI 解析。</div>';
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
  const audioPlayer = meeting.audioFileName && !/\.(md|txt)$/iu.test(meeting.originalFileName) ? `<audio id="morningAudioPlayer" controls preload="metadata" src="/api/morning-meetings/${encodeURIComponent(meeting.id)}/audio"></audio>` : "";
  openModal(readonly ? `查看会议 Agent · ${meeting.title}` : `审核会议 Agent · ${meeting.title}`, `<div class="morning-review">
    ${meeting.errorMessage ? `<div class="morning-review-help">上次解析失败：${escapeHtml(meeting.errorMessage)}</div>` : ""}
    ${audioPlayer || timedTranscript ? `<div class="morning-review-section morning-audio-review"><h3>录音与时间定位</h3>${audioPlayer}${timedTranscript ? `<div class="morning-transcript-segments">${timedTranscript}</div>` : `<div class="morning-review-help">当前记录没有时间段信息，重新解析后可按时间定位。</div>`}</div>` : ""}
    <div class="morning-review-section"><h3>会议摘要</h3><textarea id="morningSummary" ${readonly ? "disabled" : ""}>${escapeHtml(meeting.summary)}</textarea></div>
    <div class="morning-review-section"><h3>发言人与成员</h3><div class="morning-review-help">在这里绑定实际成员后，对应待办会自动显示并选择该成员；每条待办仍可单独改派给其他人。</div>${speakers}</div>
    <div class="morning-review-section"><h3>待办草稿</h3>${readonly ? "" : '<button class="btn" id="morningAddTask">＋ 手动添加待办</button>'}${tasks}</div>
    <details><summary>查看或修正转写文本</summary><textarea id="morningTranscript" ${readonly ? "disabled" : ""}>${escapeHtml(meeting.transcript)}</textarea></details>
  </div>`, readonly ? '<button class="btn" data-modal-close>关闭</button>' : '<button class="btn" data-modal-close>取消</button><button class="btn" id="morningSave">保存草稿</button><button class="btn" id="morningReanalyze">按修正文本重新解析</button><button class="btn primary" id="morningPublish">确认并发布待办</button>');
  qs<HTMLElement>("#appModal .modal")?.classList.add("agent-memory-modal");
  const speakerRows = qsa<HTMLElement>("#appModal [data-morning-speaker]");
  const taskRows = qsa<HTMLElement>("#appModal [data-morning-task]");
  const tasksForSpeaker = (label: string) => taskRows.filter((row) => row.dataset.morningSpeakerLabel === label);
  const syncSpeakerDeadlines = () => speakerRows.forEach((row) => {
    const dates = tasksForSpeaker(row.dataset.morningSpeaker || "").map((task) => task.querySelector<HTMLInputElement>('[data-field="dueAt"]')!.value);
    row.querySelector<HTMLInputElement>("[data-speaker-due]")!.value = dates.length && dates.every((date) => date === dates[0]) ? dates[0] : "";
  });
  syncSpeakerDeadlines();
  qsa<HTMLButtonElement>("[data-morning-seek]").forEach(button=>button.onclick=()=>{const audio=qs<HTMLAudioElement>("#morningAudioPlayer");if(audio){audio.currentTime=Number(button.dataset.morningSeek)||0;audio.play().catch(()=>{});}});
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
  qs<HTMLButtonElement>("#morningAddTask")?.addEventListener("click", () => {
    Object.assign(meeting,collect());
    meeting.tasks.push({id:"task_"+crypto.randomUUID().replaceAll("-",""),title:"",description:"",speakerLabel:"",assigneeId:"",dueAt:"",priority:"normal",sourceExcerpt:"",confidence:0,status:"draft"});
    openMorningMeetingReview(id);
    qsa<HTMLElement>("[data-morning-task]").at(-1)?.scrollIntoView({block:"center"});
  });
  qs<HTMLButtonElement>("#morningSave")?.addEventListener("click", async () => {
    const button=qs<HTMLButtonElement>("#morningSave")!;button.disabled=true;
    try {const result=await api<{meeting:MorningMeeting}>("/api/morning-meetings/"+id+"/review",{method:"PATCH",body:JSON.stringify(collect())});morningMeetings=morningMeetings.map(m=>m.id===id?result.meeting:m);closeModal();renderMorningMeetings();toast("草稿已保存");}
    catch(error){toast((error as Error).message,"error");button.disabled=false;}
  });
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
      toast(`已向对应成员发布 ${published.publishedCount} 项待办`, "success");
      void saved;
    } catch (error) {
      toast(error instanceof Error ? error.message : "待办发布失败", "error"); button.disabled = false; button.textContent = "确认并发布待办";
    }
  })());
}

