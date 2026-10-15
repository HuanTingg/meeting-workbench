function configureFlowTask(t:Todo){workForm('确认历史任务资料',workSelect('storeId','所属门店',stores,t.storeId)+workSelect('reviewerId','验收人',workPeople(),t.reviewerId)+'<p class="full ui-note">由你确认真实归属；不会自动通知、重派任务或补造历史验收。</p>',async b=>{await api('/api/workspace/tasks/'+t.id,{method:'POST',body:JSON.stringify({...b,action:'configure'})});});}
let selectedFlowQueue='';
function renderFlowHub(){
 let host=qs('#flowHub');if(!host){host=document.createElement('section');host.id='flowHub';host.className='panel flow-hub';qs('#dashboard .dash-heading')?.after(host);}
 const missing=state.todos.filter(t=>!t.done&&(!t.reviewerId||!t.storeId)),accept=state.todos.filter(t=>t.status==='pending_acceptance'&&t.ownerId===currentUser?.memberId),review=state.todos.filter(t=>t.status==='pending_review'&&t.reviewerId===currentUser?.memberId),closing=workIssues.filter(i=>i.status==='pending_review');
 host.innerHTML=`<h2>业务进度 · 下一步处理</h2><div class="flow-steps"><span>① 会议采集</span><span>② 确认问题</span><span>③ 审核派单</span><span>④ 执行反馈</span><span>⑤ 验收关闭</span></div><div class="flow-queues">${[['accept','等我接单',accept.length],['review','等我验收',review.length],['close','问题待关闭',closing.length],['setup','资料待确认',missing.length]].map(([key,label,n])=>`<button class="flow-queue" data-flow-queue="${key}"><b>${n}</b><span>${label}</span></button>`).join('')}</div><div id="flowQueueRows"></div>`;
 qsa<HTMLElement>('[data-flow-queue]').forEach(el=>el.onclick=()=>{const key=el.dataset.flowQueue;selectedFlowQueue=key||'';qsa<HTMLElement>('[data-flow-queue]').forEach(b=>b.classList.toggle('active',b===el));const rows=qs('#flowQueueRows')!;if(key==='close'){rows.innerHTML=closing.map(i=>`<button class="flow-row" data-flow-issue="${i.id}">${safe(i.title)} <small>必要任务已完成，等待确认问题解决</small></button>`).join('')||'<p class="task-empty">暂无待关闭问题</p>';qsa<HTMLElement>('[data-flow-issue]').forEach(b=>b.onclick=()=>void showIssue(b.dataset.flowIssue!));return;}const list=key==='accept'?accept:key==='review'?review:missing;rows.innerHTML=(key==='setup'?'<p class="flow-warning">历史资料缺少门店或验收人，请负责人逐项确认；已完成历史记录不补造验收。</p>':'')+list.map(t=>`<button class="flow-row" data-flow-task="${t.id}">${safe(t.title)}<small>${safe(memberName(t.ownerId))} · ${key==='setup'?'待确认归属和验收人':workLabel(t.status||'in_progress')}</small></button>`).join('');if(!list.length)rows.innerHTML='<p class="task-empty">暂无待处理事项</p>';qsa<HTMLElement>('[data-flow-task]').forEach(b=>b.onclick=()=>{const t=list.find(t=>t.id===b.dataset.flowTask)!;if(key==='setup'&&businessLead())configureFlowTask(t);else showWorkTask(t);});});
 if(selectedFlowQueue)qs<HTMLElement>(`[data-flow-queue="${selectedFlowQueue}"]`)?.click();
 const count=(status:string)=>state.todos.filter(t=>(t.status||(t.done?'completed':'in_progress'))===status).length;
 let states=qs('#flowStates');if(!states){states=document.createElement('section');states.id='flowStates';states.className='panel flow-hub';qs('#analyticsMetrics')!.after(states);}states.innerHTML='<h2>任务流程状态 · 当前负责范围</h2><div class="flow-queues">'+['pending_acceptance','in_progress','returned','blocked','pending_review','completed'].map(s=>`<button class="flow-queue" data-flow-state="${s}"><b>${count(s)}</b><span>${workLabel(s)}</span></button>`).join('')+'</div>';qsa<HTMLElement>('[data-flow-state]').forEach(b=>b.onclick=()=>analyticsSelect(workLabel(b.dataset.flowState!),state.todos.filter(t=>(t.status||(t.done?'completed':'in_progress'))===b.dataset.flowState)));
}
function showMeetingFlow(id:string){const m=morningMeetings.find(m=>m.id===id);if(!m)return;const issues=workIssues.filter(i=>i.meetingIds.includes(id)),tasks=state.todos.filter(t=>t.meetingId===id);openModal('会议处理进度 · '+m.title,`<div class="task-detail-layout">${taskDetailCard('会议及资料',`<p>${safe(meetingUnitName(m))} · ${safe(m.meetingDate)}</p><button class="btn" id="flowMeetingRecord">资料、附件与决策</button><button class="btn" id="flowMeetingReview">返回会议审核 / 原文</button>`)}${taskDetailCard('关联问题',issues.map(i=>`<button class="flow-row" data-meeting-issue="${i.id}">${safe(i.title)}<small>${workLabel(i.status)}${i.needsSourceReview?' · 证据待复核':''}</small></button>`).join('')||'<p class="task-empty">尚未生成问题，可先解析会议或手工整理。</p>')}${taskDetailCard('已派任务',tasks.map(t=>`<button class="flow-row" data-meeting-task="${t.id}">${safe(t.title)}<small>${safe(memberName(t.ownerId))} · ${workLabel(t.status||(t.done?'completed':'in_progress'))}</small></button>`).join('')||'<p class="task-empty">尚未派单，审核确认后才发送通知。</p>')}</div>`,'<button class="btn" data-modal-close>关闭</button>');qs('#flowMeetingRecord')!.onclick=()=>void showMeetingRecord(id);qs('#flowMeetingReview')!.onclick=()=>void openMorningMeetingReview(id);qsa<HTMLElement>('[data-meeting-issue]').forEach(b=>b.onclick=()=>void showIssue(b.dataset.meetingIssue!));qsa<HTMLElement>('[data-meeting-task]').forEach(b=>b.onclick=()=>showWorkTask(tasks.find(t=>t.id===b.dataset.meetingTask)!));}
function addMeetingFlowEntry(id:string){const body=qs('#appModal .modal-body');body?.insertAdjacentHTML('afterbegin','<div class="flow-meeting-entry"><span>会议 → 问题 → 任务 → 验收</span><button class="btn" id="meetingFlowEntry">查看关联问题、决策与处理进度</button><small>请先保存当前编辑，再打开关联资料。</small></div>');qs('#meetingFlowEntry')?.addEventListener('click',()=>showMeetingFlow(id));}
let handledFlowLink='';
async function openFlowLink(){const hash=location.hash;if(hash===handledFlowLink)return;const params=new URLSearchParams(hash.split('?')[1]||''),taskId=params.get('task');if(!taskId)return;handledFlowLink=hash;const t=state.todos.find(t=>t.id===taskId);if(t)showWorkTask(t);else toast('任务不存在或当前账号无权查看','error');}
// Refresh cross-account task feedback without replacing an open form or dialog.
let feedbackSyncBusy=false;
async function syncAccountFeedback(){
 if(!currentUser||document.hidden||feedbackSyncBusy||!['dashboard','analytics'].includes(activeView)||qs('#appModal.active')||document.activeElement?.matches('input,textarea,select'))return;
 feedbackSyncBusy=true;
 try{
  const [tasks,issues]=await Promise.all([api('/api/todos'),api('/api/workspace/issues')]);
  if(qs('#appModal.active')||document.activeElement?.matches('input,textarea,select'))return;
  workIssues=issues.issues;renderTodos(tasks.todos);renderFlowHub();renderAnalytics();if(activeView==='analytics')await renderRoleWorkbench();
 }catch{/* Retry on the next visible-page interval; api handles expired sessions. */}
 finally{feedbackSyncBusy=false;}
}
setInterval(()=>void syncAccountFeedback(),20000);
window.addEventListener('focus',()=>void syncAccountFeedback());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void syncAccountFeedback();});
// Calendar uses only the permission-filtered todos already loaded by the workspace.
let taskDisplayMode='list',taskCalendarPeriod='month',taskCalendarAnchor=localDay();
let taskCalendarRegion='',taskCalendarStore='';
function calendarDateKey(date:Date){return date.toISOString().slice(0,10);}
function calendarDueDay(t:Todo){
 const value=t.dueAt||'';
 if(!value)return '';
 if(/(?:Z|[+-]\d{2}:\d{2})$/.test(value)){
  const date=new Date(value);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(date):'';
 }
 const day=value.slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))?day:'';
}
function calendarScopeMatches(t:Todo){const store=stores.find(s=>s.id===t.storeId);return (!taskCalendarRegion||store?.region===taskCalendarRegion)&&(!taskCalendarStore||(taskCalendarStore==='__none'? !t.storeId:t.storeId===taskCalendarStore));}
function setupTaskCalendar(){
 if(qs('#taskDisplaySwitch'))return;
 qs('#dashboard .dash-heading-actions')!.insertAdjacentHTML('afterbegin','<div id="taskDisplaySwitch" class="calendar-switch" aria-label="任务展示方式"><button class="btn" data-task-display="list">列表</button><button class="btn" data-task-display="calendar">日历</button></div>');
 qs('#dashboard .local-task-tools')!.insertAdjacentHTML('beforeend','<select id="calendarRegion" aria-label="大区筛选"></select><select id="calendarStore" aria-label="门店筛选"></select>');
 qs('#todoRows')!.insertAdjacentHTML('afterend','<section id="taskCalendar" hidden aria-label="待办日历"></section>');
 qsa<HTMLElement>('[data-task-display]').forEach(b=>b.onclick=()=>{taskDisplayMode=b.dataset.taskDisplay!;renderTodos(state.todos);});
 qs<HTMLSelectElement>('#calendarRegion')!.onchange=e=>{taskCalendarRegion=(e.target as HTMLSelectElement).value;taskCalendarStore='';renderTodos(state.todos);};
 qs<HTMLSelectElement>('#calendarStore')!.onchange=e=>{taskCalendarStore=(e.target as HTMLSelectElement).value;renderTodos(state.todos);};
}
function renderTaskCalendar(visible:Todo[]){
 const calendar=taskDisplayMode==='calendar',dash=qs('#dashboard')!;
 dash.classList.toggle('calendar-mode',calendar);
 const heading=qs('#dashboard .dash-task-panel h2');if(heading?.firstChild)heading.firstChild.textContent=calendar?'待办日历 ':'任务清单 ';
 qsa<HTMLElement>('[data-task-display]').forEach(b=>{b.classList.toggle('active',b.dataset.taskDisplay===taskDisplayMode);b.setAttribute('aria-pressed',String(b.dataset.taskDisplay===taskDisplayMode));});
 qs<HTMLSelectElement>('#calendarRegion')!.innerHTML='<option value="">全部大区</option>'+[...new Set(stores.map(s=>s.region).filter(Boolean))].map(r=>`<option value="${safe(r)}">${safe(r)}</option>`).join('');
 qs<HTMLSelectElement>('#calendarRegion')!.value=taskCalendarRegion;
 qs<HTMLSelectElement>('#calendarStore')!.innerHTML='<option value="">全部门店</option>'+stores.filter(s=>!taskCalendarRegion||s.region===taskCalendarRegion).map(s=>`<option value="${safe(s.id)}">${safe(s.name)}</option>`).join('')+'<option value="__none">未关联门店</option>';
 qs<HTMLSelectElement>('#calendarStore')!.value=taskCalendarStore;
 const host=qs<HTMLElement>('#taskCalendar')!;host.hidden=!calendar;if(!calendar)return;
 const anchor=new Date(taskCalendarAnchor+'T00:00:00Z'),month=taskCalendarPeriod==='month';
 const start=new Date(anchor);if(month)start.setUTCDate(1);start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
 const last=new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth()+1,0));
 const count=month?Math.ceil(((new Date(Date.UTC(anchor.getUTCFullYear(),anchor.getUTCMonth(),1)).getUTCDay()+6)%7+last.getUTCDate())/7)*7:7;
 const end=new Date(start);end.setUTCDate(end.getUTCDate()+count-1);
 const title=month?`${anchor.getUTCFullYear()} 年 ${anchor.getUTCMonth()+1} 月`:`${calendarDateKey(start)} — ${calendarDateKey(end)}`;
 const groups=new Map<string,Todo[]>();visible.forEach(t=>{const key=calendarDueDay(t);groups.set(key,[...(groups.get(key)||[]),t]);});
 const event=(t:Todo)=>{const tone=t.done||t.status==='completed'?'complete':t.status==='pending_review'?'review':overdue(t)?'late':'progress';return `<button class="calendar-event ${tone}" data-calendar-task="${safe(t.id)}" title="${safe(t.title)} · ${safe(memberName(t.ownerId))}"><b>${safe(t.title)}</b><small>${safe(memberName(t.ownerId))} · ${tone==='late'?'逾期':workLabel(t.status||(t.done?'completed':'in_progress'))}</small></button>`;};
 const days=Array.from({length:count},(_,i)=>{const d=new Date(start);d.setUTCDate(d.getUTCDate()+i);const day=calendarDateKey(d),items=groups.get(day)||[];return `<div class="calendar-day ${d.getUTCMonth()!==anchor.getUTCMonth()&&month?'outside':''} ${day===localDay()?'today':''}"><div class="calendar-day-heading"><time datetime="${day}">${d.getUTCDate()}${day===localDay()?' · 今天':''}</time><small>${items.length?items.length+' 项':''}</small></div>${items.slice(0,3).map(event).join('')}${items.length>3?`<button class="calendar-more" data-calendar-day="${day}">还有 ${items.length-3} 项</button>`:''}</div>`;}).join('');
 const undated=groups.get('')||[];
 host.innerHTML=`<div class="calendar-toolbar"><div><button class="btn" data-calendar-shift="-1" aria-label="上一${month?'月':'周'}">‹</button><strong aria-live="polite">${title}</strong><button class="btn" data-calendar-shift="1" aria-label="下一${month?'月':'周'}">›</button><button class="btn" id="calendarToday">今天</button></div><div class="calendar-switch"><button class="btn ${month?'active':''}" data-calendar-period="month" aria-pressed="${month}">月</button><button class="btn ${!month?'active':''}" data-calendar-period="week" aria-pressed="${!month}">周</button></div></div><p class="ui-note">按截止日期展示 · 北京时间 · 沿用上方任务筛选</p><div class="calendar-legend"><span class="progress">进行中 / 待处理</span><span class="late">逾期</span><span class="review">待验收</span><span class="complete">已完成</span></div><div class="calendar-scroll"><div class="calendar-grid">${['周一','周二','周三','周四','周五','周六','周日'].map(d=>`<div class="calendar-weekday">${d}</div>`).join('')}${days}</div></div><div class="calendar-undated"><strong>未安排日期 <small>${undated.length} 项</small></strong>${undated.length?`<button class="btn" data-calendar-day="">查看待办</button>`:'<span class="ui-note">没有未设截止日期的待办</span>'}</div>`;
 qsa<HTMLElement>('[data-calendar-task]',host).forEach(b=>b.onclick=()=>showWorkTask(visible.find(t=>t.id===b.dataset.calendarTask)!));
 qsa<HTMLElement>('[data-calendar-day]',host).forEach(b=>b.onclick=()=>showBoardItems(b.dataset.calendarDay||'未安排日期',groups.get(b.dataset.calendarDay||'')||[],'task',visible));
 qsa<HTMLElement>('[data-calendar-period]',host).forEach(b=>b.onclick=()=>{taskCalendarPeriod=b.dataset.calendarPeriod!;renderTodos(state.todos);});
 qsa<HTMLElement>('[data-calendar-shift]',host).forEach(b=>b.onclick=()=>{const d=new Date(anchor),step=Number(b.dataset.calendarShift);if(month){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+step);}else d.setUTCDate(d.getUTCDate()+step*7);taskCalendarAnchor=calendarDateKey(d);renderTodos(state.todos);});
 qs('#calendarToday')!.onclick=()=>{taskCalendarAnchor=localDay();renderTodos(state.todos);};
}
