type CompletionRecord={status?:string;id:string;done:boolean;at:string;actorName:string;note:string;attachment?:{id:string;name:string;size:number}|null};
type Todo = {executionDate?:string;kind?:string;issueId?:string;storeId?:string;reviewerId?:string;dispatchedBy?:string;status?:string;timeline?:Array<{action:string;at:string;actorName:string;note:string;previousOwnerId?:string;ownerId?:string}>;createdAt?:string;completions?:CompletionRecord[];completedAt?:string;id:string;title:string;description?:string;ownerId:string;dueAt:string;priority:string;done:boolean;meetingId?:string;sourceExcerpt?:string};
const qs = <T extends Element = HTMLElement>(selector:string, root:ParentNode=document) => root.querySelector<T>(selector);
const qsa = <T extends Element = HTMLElement>(selector:string, root:ParentNode=document) => [...root.querySelectorAll<T>(selector)];
const escapeHtml = (value:unknown) => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const state = {todos:[] as Todo[]};
let members:Array<{id:string;name:string;department:string;region?:string;storeId?:string;position?:string;managerId?:string;email?:string;organizationId?:string;employmentStatus?:string;unitType?:string;dingtalkUserId?:string;feishuOpenId?:string;feishuAppId?:string}>=[];
let activeView='dashboard';
let taskFilter='all';
const localDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());
async function api<T=any>(url:string, options:RequestInit={}):Promise<T> {
  let response:Response;
  try{response=await fetch(url,{...options,headers:{'X-Requested-With':'MeetingLocal',...(typeof options.body==='string'?{'Content-Type':'application/json'}:{}),...options.headers}});}catch{throw Error('无法连接本地服务，请运行“启动会议工作台.cmd”后重试。');}
  const result=await response.json();if(response.status===401&&currentUser){location.reload();throw Error('登录已失效');}if(!response.ok)throw Error(result.message||'操作失败');return result;
}
function toast(message:string, type='success') {
  const host=qs<HTMLElement>('#notice')!;host.textContent=message;host.dataset.type=type;host.hidden=false;
}
let modalReturn:HTMLElement|null=null;
function openModal(title:string, body:string, footer:string) {
  modalReturn=document.activeElement as HTMLElement;
  const host=qs<HTMLElement>('#appModal')!;
  host.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div class="modal-head"><h2 id="modalTitle">${escapeHtml(title)}</h2><button class="btn" data-modal-close aria-label="关闭弹窗">×</button></div><div class="modal-body">${body}</div><div class="modal-foot">${footer}</div></div>`;
  host.classList.add('active');
  qsa('[data-modal-close]',host).forEach(b=>b.addEventListener('click',closeModal));
  qs<HTMLElement>('input,textarea,select,button',host)?.focus();
}
function closeModal(){qs('#appModal')!.classList.remove('active');qs('#appModal')!.replaceChildren();modalReturn?.focus();}
document.addEventListener('keydown',e=>{const host=qs<HTMLElement>('#appModal')!;if(!host.classList.contains('active'))return;if(e.key==='Escape')closeModal();if(e.key==='Tab'){const items=qsa<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',host).filter(x=>x.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
function memberName(id:string){return members.find(m=>m.id===id)?.name||'未指定';}
function memberOptions(selected=''){return '<option value="">选择负责人</option>'+members.map(m=>`<option value="${m.id}" ${selected===m.id?'selected':''}>${escapeHtml(m.name)}${m.department?' · '+escapeHtml(m.department):''}</option>`).join('');}
function overdue(t:Todo){return !t.done&&!!t.dueAt&&Date.parse(t.dueAt.length===10?t.dueAt+'T23:59:59':t.dueAt.replace(' ','T'))<Date.now();}
function renderTopbarStats(){qs('#taskCount')!.textContent=String(state.todos.filter(t=>!t.done).length);}
function renderTodos(todos:Todo[]) {
  state.todos=todos;const pending=todos.filter(t=>!t.done),late=pending.filter(overdue),complete=todos.filter(t=>t.done),high=pending.filter(t=>t.priority==='high');
  const today=pending.filter(t=>t.dueAt?.slice(0,10)===localDay()),rate=todos.length?Math.round(complete.length/todos.length*100):0;
  qs('#dashboardDate')!.textContent=new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Shanghai'}).format(new Date());
  qs('#metrics')!.innerHTML=[['待完成',pending.length,'pending','逐项推进，及时交付','blue'],['今日到期',today.length,'today','今天需要完成的任务','amber'],['已逾期',late.length,'overdue','跟进进展，确认交付时间','rose'],['完成率',todos.length?rate+'%':'—','done',complete.length+' 项已完成 / '+todos.length+' 项任务','green']].map(([label,value,filter,hint,tone])=>`<button class="dash-stat ${tone}" data-filter="${filter}"><span>${label}<i>↗</i></span><strong>${value}</strong><small>${hint}</small></button>`).join('');
  qsa<HTMLElement>('[data-filter]').forEach(button=>{const selected=button.dataset.filter===taskFilter;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));button.onclick=()=>{taskFilter=button.dataset.filter!;renderTodos(state.todos);};});
  const search=qs<HTMLInputElement>('#taskSearch')!.value.toLowerCase(),owner=qs<HTMLSelectElement>('#ownerFilter')!.value;
  const visible=todos.filter(t=>(taskFilter==='all'||(taskFilter==='mine'?(!t.done&&t.ownerId===currentUser?.memberId):taskFilter==='today'?(!t.done&&t.dueAt?.slice(0,10)===localDay()):taskFilter==='review'?t.status==='pending_review':taskFilter==='done'?t.done:taskFilter==='overdue'?overdue(t):!t.done))&&(!owner||owner===t.ownerId)&&(`${t.title} ${t.description||''}`.toLowerCase().includes(search)));
  qs('#visibleTaskCount')!.textContent=String(visible.length);
  qs('#taskScope')!.textContent=({'all':'全部任务','mine':'我的待办','today':'今日到期','done':'已完成','overdue':'已逾期','pending':'待完成','review':'待验收'} as Record<string,string>)[taskFilter]+' · '+(businessLead()?'负责范围':'个人任务与验收任务');
  const upcoming=pending.filter(t=>t.dueAt&&t.dueAt.slice(0,10)<=new Date(Date.now()+7*86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})).sort((a,b)=>a.dueAt.localeCompare(b.dueAt));
  qs('#deadlineRows')!.innerHTML=upcoming.length?upcoming.slice(0,5).map(t=>`<button class="dash-reminder" data-detail="${t.id}"><span class="dash-reminder-status ${overdue(t)?'late':''}">${overdue(t)?'逾期':t.dueAt.slice(0,10)===localDay()?'今天':'即将到期'}</span><b>${escapeHtml(t.title)}</b><small>${escapeHtml(memberName(t.ownerId))} · ${escapeHtml(t.dueAt)}</small></button>`).join(''):'<div class="dash-empty">暂无逾期或未来 7 天到期的任务</div>';
  qs('#progressNumber')!.textContent=todos.length?rate+'%':'—';qs<HTMLProgressElement>('#taskProgress')!.value=rate;
  qs('#progressCaption')!.textContent=todos.length?`已完成 ${complete.length} 项，还有 ${pending.length} 项待推进`:'添加第一项任务，开始记录交付进度';
  qs('#priorityCaption')!.textContent=high.length?`其中 ${high.length} 项待完成任务为高优先级`:'当前没有高优先级待办';
  qs('#completionFeed')!.innerHTML=complete.length?complete.slice().sort((a,b)=>(b.completedAt||'').localeCompare(a.completedAt||'')).slice(0,5).map(t=>{const record=t.completions?.filter(c=>c.done).at(-1);return `<article class="dash-completion"><span class="dash-check">✓</span><div><button class="task-title" data-detail="${t.id}">${escapeHtml(t.title)}</button><small>${escapeHtml(memberName(t.ownerId))} · ${t.completedAt?escapeHtml(new Date(t.completedAt).toLocaleString('zh-CN')):'已完成'}</small>${record?.note?'<p>'+escapeHtml(record.note)+'</p>':''}${record?.attachment?'<a href="/api/todos/'+t.id+'/attachments/'+record.attachment.id+'">附件 · '+escapeHtml(record.attachment.name)+'</a>':''}</div></article>`;}).join(''):'<div class="dash-empty">完成任务后，交付记录会显示在这里</div>';
  qs<HTMLElement>('#memberProgressPanel')!.hidden=!businessLead();
  qs('#todoRows')!.innerHTML=visible.length?visible.map(t=>`<article class="local-todo ${t.done?'is-done':''}"><input type="checkbox" data-complete="${t.id}" aria-label="完成 ${escapeHtml(t.title)}" ${t.done?'checked':''}><div><button class="task-title" data-detail="${t.id}">${escapeHtml(t.title)}</button><small>${escapeHtml(memberName(t.ownerId))} · ${escapeHtml(t.dueAt||'未设截止日期')}${t.meetingId?' · 来自会议':''}</small></div><span class="badge ${overdue(t)?'red':t.priority==='high'?'red':'green'}">${t.status&&['pending_acceptance','returned','blocked','pending_review'].includes(t.status)?workLabel(t.status):t.done?'已完成':overdue(t)?'逾期':({high:'高优先级',medium:'中优先级',normal:'普通'}[t.priority]||'普通')}</span></article>`).join(''):'<div class="todo-history-empty">当前没有符合条件的待办</div>';
  qsa<HTMLInputElement>('[data-complete]').forEach(box=>box.onchange=async()=>{const t=todos.find(t=>t.id===box.dataset.complete)!;box.checked=t.done;if(['pending_review','pending_acceptance','returned','blocked'].includes(t.status||'')){showWorkTask(t);return;}if(!t.done){completeTask(t);return;}if(!confirm('重新打开这项已完成的任务？完成记录和附件将保留。'))return;box.disabled=true;try{await api('/api/todos/'+t.id,{method:'PATCH',body:JSON.stringify({done:false})});await refreshLocal();}catch(e){toast((e as Error).message,'error');}finally{box.disabled=false;}});
  qsa<HTMLElement>('[data-detail]').forEach(button=>button.onclick=()=>showWorkTask(todos.find(t=>t.id===button.dataset.detail)!));
  qs('#memberLoad')!.innerHTML=members.length?members.map(m=>{const all=todos.filter(t=>t.ownerId===m.id),done=all.filter(t=>t.done).length;return `<div class="load-row"><span>${escapeHtml(m.name)}<small>${escapeHtml(m.department)}</small></span><b>${all.length-done}<small>待处理</small></b><b>${done}<small>已完成</small></b></div>`;}).join(''):'<div class="todo-history-empty">先添加任务负责人</div>';
  renderTopbarStats();
}
async function refreshLocal() {
  const manager=currentUser?.role==='manager';
  const [m,t,p,a]=await Promise.all([api('/api/morning-meetings'),api('/api/todos'),api('/api/members'),manager?api('/api/accounts'):Promise.resolve({accounts:[]})]);
  accountRows=a.accounts;
  morningMeetings=m.meetings;morningMeetingMembers=m.members;members=currentUser?.role==='manager'?p.members:m.members;
  const owner=qs<HTMLSelectElement>('#ownerFilter')!.value;qs('#ownerFilter')!.innerHTML='<option value="">所有负责人</option>'+members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');qs<HTMLSelectElement>('#ownerFilter')!.value=owner;
  stores=(await api('/api/stores')).stores;setupMeetingFilters();renderMorningMeetings();renderTodos(t.todos);renderMembers();renderAnalytics();renderOperations();await refreshOperations();renderFlowHub();await openFlowLink();
}
function newTask() {
  if(!members.length){toast('请先在成员中添加负责人','error');navigateLocal('members');return;}
  openModal('新增待办',`<form id="newTaskForm" class="form-grid"><label class="form-field">所属门店<select name="storeId">${storeOptions()}</select></label><label class="form-field full">任务标题<input name="title" required maxlength="255"></label><label class="form-field">负责人<select name="ownerId" required>${memberOptions(currentUser?.role==='member'?currentUser.memberId:'')}</select></label><label class="form-field">验收人<select name="reviewerId" required>${memberOptions(currentUser?.memberId)}</select></label><label class="form-field">事项性质<select name="kind"><option value="issue">问题处理</option><option value="routine">例行待办</option></select></label><label class="form-field">执行日期<input name="executionDate" type="date"></label><label class="form-field">截止时间<input name="dueAt" type="datetime-local"></label><label class="form-field">优先级<select name="priority"><option value="normal">普通</option><option value="medium">中</option><option value="high">高</option></select></label><label class="form-field full">执行说明<textarea name="description" maxlength="2000"></textarea></label></form>`,'<button class="btn" data-modal-close>取消</button><button class="btn primary" type="submit" form="newTaskForm">确认并派单</button>');
  qs<HTMLFormElement>('#newTaskForm')!.onsubmit=async e=>{e.preventDefault();const form=e.currentTarget as HTMLFormElement;const button=qs<HTMLButtonElement>('[form="newTaskForm"]')!;button.disabled=true;try{const values=Object.fromEntries(new FormData(form));const day=String(values.executionDate||values.dueAt||'').slice(0,10);const same=state.todos.filter(t=>t.storeId&&t.storeId===values.storeId&&t.title.trim().toLowerCase()===String(values.title).trim().toLowerCase()&&(t.executionDate||(t.dueAt?.includes('T')&&/Z$|[+-]\d{2}:\d{2}$/.test(t.dueAt)?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(t.dueAt)):t.dueAt||'').slice(0,10))===day);if(day&&same.length&&!confirm('当前可见范围已有 '+same.length+' 条同门店、同事项、同执行日期的待办。仍要单独创建吗？')){button.disabled=false;return;}await api('/api/todos',{method:'POST',body:JSON.stringify(values)});closeModal();await refreshLocal();toast('待办已保存；已启用的钉钉和飞书通知将自动发送，可在对应配置页查看结果。');}catch(e){toast((e as Error).message,'error');button.disabled=false;}};
}
function renderMembers(){if(currentUser?.role==='manager')void renderChain();}

async function loadSettings(){const c=await api('/api/settings');const f=qs<HTMLFormElement>('#settingsForm')!;for(const key of ['baseUrl','model','transcriptionUrl'])(f.elements.namedItem(key) as HTMLInputElement).value=c[key];(f.elements.namedItem('aiEnabled') as HTMLInputElement).checked=c.aiEnabled;for(const [key,flag] of [['apiKey','hasKey'],['transcriptionKey','hasTranscriptionKey']]){const field=f.elements.namedItem(key) as HTMLInputElement;field.value='';field.placeholder=c[flag]?'已保存，留空保留':'未设置';}(f.elements.namedItem('clearKey') as HTMLInputElement).checked=false;(f.elements.namedItem('clearTranscriptionKey') as HTMLInputElement).checked=false;}
function navigateLocal(view:string){view=view.split('?')[0];if(stores.length||morningMeetings.length){renderOperations();void refreshOperations();}if(currentUser?.role!=='manager'&&!['dashboard','morning-meetings','analytics','assistant','preparation'].includes(view))view='dashboard';activeView=['dashboard','analytics','morning-meetings','assistant','preparation','members','runtime','settings','dingtalk','dingtalk-guide','feishu','feishu-guide'].includes(view)?view:'dashboard';qsa<HTMLElement>('[data-nav]').forEach(b=>{b.classList.toggle('active',b.dataset.nav===activeView);if(b.dataset.nav===activeView)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});qsa<HTMLElement>('.workspace>.view').forEach(v=>{v.classList.toggle('active',v.id===activeView);v.hidden=v.id!==activeView;});const system=qs<HTMLDetailsElement>('#systemNavGroup');if(system&&['members','runtime','settings','dingtalk','dingtalk-guide','feishu','feishu-guide'].includes(activeView))system.open=true;const group=qs<HTMLDetailsElement>('#dingNavGroup')!;const inDing=activeView==='dingtalk'||activeView==='dingtalk-guide';group.classList.toggle('is-current',inDing);if(inDing)group.open=true;const feiGroup=qs<HTMLDetailsElement>('#feiNavGroup')!;const inFei=activeView==='feishu'||activeView==='feishu-guide';feiGroup.classList.toggle('is-current',inFei);if(inFei)feiGroup.open=true;if(location.hash.slice(1).split('?')[0]!==activeView)location.hash=activeView;document.title=({assistant:'会议助手',preparation:'待办整理',feishu:'飞书配置 / 接入配置','feishu-guide':'飞书配置 / 使用说明',dashboard:'任务派发',analytics:'数据看板','morning-meetings':'会议转写',members:'门店组织',runtime:'运行管理',settings:'智能配置',dingtalk:'钉钉配置 / 接入配置','dingtalk-guide':'钉钉配置 / 使用说明'} as any)[activeView]+' · 会议纪要';if(activeView==='dingtalk')loadDingTalk().catch(e=>toast(e.message,'error'));if(activeView==='feishu')loadFeishu().catch(e=>toast(e.message,'error'));if(activeView==='settings')loadSettings().catch(e=>toast(e.message,'error'));}
async function bootLocal(){
  bindAnalytics();
  bindDingTalk();
  bindFeishu();
  qsa<HTMLElement>('[data-nav]').forEach(b=>{b.setAttribute('aria-label',b.textContent?.trim()||'');b.onclick=()=>navigateLocal(b.dataset.nav!);});
  qs<HTMLElement>('#newTask')!.onclick=newTask;qs<HTMLElement>('#morningMeetingUploadButton')!.onclick=openMorningMeetingUpload;
  qs<HTMLInputElement>('#taskSearch')!.oninput=()=>renderTodos(state.todos);qs<HTMLSelectElement>('#ownerFilter')!.onchange=()=>renderTodos(state.todos);
  qsa<HTMLElement>('[data-filter]').forEach(b=>b.onclick=()=>{taskFilter=b.dataset.filter!;qsa('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTodos(state.todos);});

  const configForm=qs<HTMLFormElement>('#settingsForm')!;
  const submitSettings=async(test:boolean)=>{if(!configForm.reportValidity())return;const body:any=Object.fromEntries(new FormData(configForm));for(const key of ['aiEnabled','clearKey','clearTranscriptionKey'])body[key]=(configForm.elements.namedItem(key) as HTMLInputElement).checked;const buttons=qsa<HTMLButtonElement>('button',configForm);buttons.forEach(b=>b.disabled=true);qs('#settingsResult')!.textContent=test?'正在测试连接…':'正在保存…';try{const result=await api('/api/settings'+(test?'/test':''),{method:test?'POST':'PUT',body:JSON.stringify(body)});qs('#settingsResult')!.textContent=test?result.message:'已保存，下一次解析将使用新配置。';if(!test)await loadSettings();}catch(e){qs('#settingsResult')!.textContent=(e as Error).message;}finally{buttons.forEach(b=>b.disabled=false);}};
  configForm.onsubmit=e=>{e.preventDefault();void submitSettings(false);};qs<HTMLElement>('#testAI')!.onclick=()=>void submitSettings(true);
  window.onhashchange=()=>{if(location.hash.slice(1).split('?')[0]!==activeView)navigateLocal(location.hash.slice(1));void openFlowLink();};
  navigateLocal(location.hash.slice(1)||'dashboard');
  try{await refreshLocal();}catch(e){toast((e as Error).message,'error');}
}
