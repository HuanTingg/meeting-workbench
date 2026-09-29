type CompletionRecord={id:string;done:boolean;at:string;actorName:string;note:string;attachment?:{id:string;name:string;size:number}|null};
type Todo = {completions?:CompletionRecord[];completedAt?:string;id:string;title:string;description?:string;ownerId:string;dueAt:string;priority:string;done:boolean;meetingId?:string;sourceExcerpt?:string};
const qs = <T extends Element = HTMLElement>(selector:string, root:ParentNode=document) => root.querySelector<T>(selector);
const qsa = <T extends Element = HTMLElement>(selector:string, root:ParentNode=document) => [...root.querySelectorAll<T>(selector)];
const escapeHtml = (value:unknown) => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const state = {todos:[] as Todo[]};
let members:Array<{id:string;name:string;department:string;dingtalkUserId?:string;feishuOpenId?:string;feishuAppId?:string}>=[];
let activeView='dashboard';
let taskFilter='pending';
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
document.addEventListener('keydown',e=>{const host=qs<HTMLElement>('#appModal')!;if(!host.classList.contains('active'))return;if(e.key==='Escape'&&!currentUser?.mustChangePassword)closeModal();if(e.key==='Tab'){const items=qsa<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]',host).filter(x=>x.getClientRects().length);const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
function memberName(id:string){return members.find(m=>m.id===id)?.name||'未指定';}
function memberOptions(selected=''){return '<option value="">选择负责人</option>'+members.map(m=>`<option value="${m.id}" ${selected===m.id?'selected':''}>${escapeHtml(m.name)}${m.department?' · '+escapeHtml(m.department):''}</option>`).join('');}
function overdue(t:Todo){return !t.done&&!!t.dueAt&&Date.parse(t.dueAt.length===10?t.dueAt+'T23:59:59':t.dueAt.replace(' ','T'))<Date.now();}
function renderTopbarStats(){qs('#taskCount')!.textContent=String(state.todos.filter(t=>!t.done).length);}
function renderTodos(todos:Todo[]) {
  state.todos=todos;const pending=todos.filter(t=>!t.done),late=pending.filter(overdue),complete=todos.filter(t=>t.done),high=pending.filter(t=>t.priority==='high');
  qs('#metrics')!.innerHTML=[['待处理',pending.length,'项任务'],['已逾期',late.length,'需优先安排'],['高优先级',high.length,'项重点工作'],['已完成',complete.length,'项交付']].map(([label,value,hint])=>`<div class="focus-metric"><span>${label}</span><b>${value}</b><small>${hint}</small></div>`).join('');
  qs('#briefingBasis')!.textContent=currentUser?.role==='member'?`你共有 ${todos.length} 项待办。`:`共有 ${morningMeetings.length} 份会议记录、${todos.length} 项待办。`;
  qs('#briefingAction')!.textContent=late.length?`优先处理 ${late.length} 项逾期任务。`:pending.length?'按负责人和截止日期推进待办。':(currentUser?.role==='member'?'当前没有待处理任务。':'上传会议资料，整理下一步行动。');
  qs('#briefingImpact')!.textContent=todos.length?`任务完成率 ${Math.round(complete.length/todos.length*100)}%`:'暂无任务，不计算完成率。';
  const search=qs<HTMLInputElement>('#taskSearch')!.value.toLowerCase(),owner=qs<HTMLSelectElement>('#ownerFilter')!.value;
  const visible=todos.filter(t=>(taskFilter==='all'||(taskFilter==='done'?t.done:taskFilter==='overdue'?overdue(t):!t.done))&&(!owner||owner===t.ownerId)&&(`${t.title} ${t.description||''}`.toLowerCase().includes(search)));
  qs('#todoRows')!.innerHTML=visible.length?visible.map(t=>`<article class="local-todo ${t.done?'is-done':''}"><input type="checkbox" data-complete="${t.id}" aria-label="完成 ${escapeHtml(t.title)}" ${t.done?'checked':''}><div><button class="task-title" data-detail="${t.id}">${escapeHtml(t.title)}</button><small>${escapeHtml(memberName(t.ownerId))} · ${escapeHtml(t.dueAt||'未设截止日期')}${t.meetingId?' · 来自会议':''}</small></div><span class="badge ${overdue(t)?'red':t.priority==='high'?'red':'green'}">${overdue(t)?'逾期':({high:'高优先级',medium:'中优先级',normal:'普通'}[t.priority]||'普通')}</span></article>`).join(''):'<div class="todo-history-empty">当前没有符合条件的待办</div>';
  qsa<HTMLInputElement>('[data-complete]').forEach(box=>box.onchange=async()=>{const t=todos.find(t=>t.id===box.dataset.complete)!;box.checked=t.done;if(!t.done){completeTask(t);return;}if(!confirm('重新打开这项已完成的任务？完成记录和附件将保留。'))return;box.disabled=true;try{await api('/api/todos/'+t.id,{method:'PATCH',body:JSON.stringify({done:false})});await refreshLocal();}catch(e){toast((e as Error).message,'error');}finally{box.disabled=false;}});
  qsa<HTMLElement>('[data-detail]').forEach(button=>button.onclick=()=>{const t=todos.find(t=>t.id===button.dataset.detail)!;openModal('任务详情',`<h3>${escapeHtml(t.title)}</h3><p>${escapeHtml(t.description||'暂无任务说明')}</p><p>负责人：${escapeHtml(memberName(t.ownerId))}</p><p>截止时间：${escapeHtml(t.dueAt||'未指定')}</p><blockquote>${escapeHtml(t.sourceExcerpt||'手动创建，无会议原文')}</blockquote><h3>完成情况</h3>${completionHistory(t)}`,`<button class="btn" data-modal-close>关闭</button>${t.meetingId?'<button class="btn primary" id="taskSource">查看来源会议</button>':''}`);qs<HTMLElement>('#taskSource')?.addEventListener('click',()=>openMorningMeetingReview(t.meetingId!));});
  qs('#memberLoad')!.innerHTML=members.length?members.map(m=>{const all=todos.filter(t=>t.ownerId===m.id),done=all.filter(t=>t.done).length;return `<div class="load-row"><span>${escapeHtml(m.name)}<small>${escapeHtml(m.department)}</small></span><b>${all.length-done}<small>待处理</small></b><b>${done}<small>已完成</small></b></div>`;}).join(''):'<div class="todo-history-empty">先添加任务负责人</div>';
  renderTopbarStats();
}
async function refreshLocal() {
  const manager=currentUser?.role==='manager';
  const [m,t,p,a]=await Promise.all([api('/api/morning-meetings'),api('/api/todos'),api('/api/members'),manager?api('/api/accounts'):Promise.resolve({accounts:[]})]);
  accountRows=a.accounts;
  morningMeetings=m.meetings;morningMeetingMembers=m.members;members=p.members;
  const owner=qs<HTMLSelectElement>('#ownerFilter')!.value;qs('#ownerFilter')!.innerHTML='<option value="">所有负责人</option>'+members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');qs<HTMLSelectElement>('#ownerFilter')!.value=owner;
  renderMorningMeetings();renderTodos(t.todos);renderMembers();
}
function newTask() {
  if(!members.length){toast('请先在成员中添加负责人','error');navigateLocal('members');return;}
  openModal('新增待办',`<form id="newTaskForm" class="form-grid"><label class="form-field full">任务标题<input name="title" required maxlength="255"></label><label class="form-field">负责人<select name="ownerId" required>${memberOptions(currentUser?.role==='member'?currentUser.memberId:'')}</select></label><label class="form-field">截止时间<input name="dueAt" type="datetime-local"></label><label class="form-field">优先级<select name="priority"><option value="normal">普通</option><option value="medium">中</option><option value="high">高</option></select></label><label class="form-field full">执行说明<textarea name="description" maxlength="2000"></textarea></label></form>`,'<button class="btn" data-modal-close>取消</button><button class="btn primary" type="submit" form="newTaskForm">保存待办</button>');
  qs<HTMLFormElement>('#newTaskForm')!.onsubmit=async e=>{e.preventDefault();const form=e.currentTarget as HTMLFormElement;const button=qs<HTMLButtonElement>('[form="newTaskForm"]')!;button.disabled=true;try{await api('/api/todos',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});closeModal();await refreshLocal();toast('待办已保存；已启用的钉钉和飞书通知将自动发送，可在对应配置页查看结果。');}catch(e){toast((e as Error).message,'error');button.disabled=false;}};
}
function renderMembers(){qs('#memberRows')!.innerHTML=members.length?members.map(m=>`<div class="load-row"><span>${escapeHtml(m.name)}<small>${escapeHtml(m.department||'未填写部门')}</small><small>${(()=>{const a=accountRows.find(a=>a.memberId===m.id);return a?escapeHtml(a.username)+' · '+(a.role==='manager'?'负责人':'普通成员')+' · '+(a.disabled?'已停用':'已启用'):'尚未分配账号';})()}</small></span><button class="btn" data-account="${m.id}">${accountRows.some(a=>a.memberId===m.id)?"管理账号":"分配账号"}</button><button class="btn" data-bind-ding="${m.id}">${m.dingtalkUserId?"钉钉已绑定":"绑定钉钉"}</button><button class="btn" data-bind-fei="${m.id}">${m.feishuOpenId?"飞书已绑定":"绑定飞书"}</button><button class="btn" data-delete-member="${m.id}">删除</button></div>`).join(''):'<div class="todo-history-empty">暂无成员。添加成员后可分配登录账号与任务。</div>';qsa<HTMLElement>('[data-account]').forEach(b=>b.onclick=()=>void editMemberAccount(b.dataset.account!));qsa<HTMLElement>('[data-bind-ding]').forEach(b=>b.onclick=()=>editDingMember(b.dataset.bindDing!));qsa<HTMLElement>('[data-bind-fei]').forEach(b=>b.onclick=()=>void editFeishuMember(b.dataset.bindFei!));qsa<HTMLElement>('[data-delete-member]').forEach(b=>b.onclick=async()=>{if(!confirm('删除这位尚未分配任务的成员？'))return;try{await api('/api/members/'+b.dataset.deleteMember,{method:'DELETE'});await refreshLocal();}catch(e){toast((e as Error).message,'error');}});}
async function loadSettings(){const c=await api('/api/settings');const f=qs<HTMLFormElement>('#settingsForm')!;for(const key of ['baseUrl','model','transcriptionUrl'])(f.elements.namedItem(key) as HTMLInputElement).value=c[key];(f.elements.namedItem('aiEnabled') as HTMLInputElement).checked=c.aiEnabled;for(const [key,flag] of [['apiKey','hasKey'],['transcriptionKey','hasTranscriptionKey']]){const field=f.elements.namedItem(key) as HTMLInputElement;field.value='';field.placeholder=c[flag]?'已保存，留空保留':'未设置';}(f.elements.namedItem('clearKey') as HTMLInputElement).checked=false;(f.elements.namedItem('clearTranscriptionKey') as HTMLInputElement).checked=false;}
function navigateLocal(view:string){if(currentUser?.role!=='manager'&&!['dashboard','morning-meetings'].includes(view))view='dashboard';activeView=['dashboard','morning-meetings','members','settings','dingtalk','dingtalk-guide','feishu','feishu-guide'].includes(view)?view:'dashboard';qsa<HTMLElement>('[data-nav]').forEach(b=>{b.classList.toggle('active',b.dataset.nav===activeView);if(b.dataset.nav===activeView)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});qsa<HTMLElement>('.workspace>.view').forEach(v=>{v.classList.toggle('active',v.id===activeView);v.hidden=v.id!==activeView;});const group=qs<HTMLDetailsElement>('#dingNavGroup')!;const inDing=activeView==='dingtalk'||activeView==='dingtalk-guide';group.classList.toggle('is-current',inDing);if(inDing)group.open=true;const feiGroup=qs<HTMLDetailsElement>('#feiNavGroup')!;const inFei=activeView==='feishu'||activeView==='feishu-guide';feiGroup.classList.toggle('is-current',inFei);if(inFei)feiGroup.open=true;location.hash=activeView;document.title=({feishu:'飞书配置 / 接入配置','feishu-guide':'飞书配置 / 使用说明',dashboard:'任务总览','morning-meetings':'会议管理',members:'成员管理',settings:'智能配置',dingtalk:'钉钉配置 / 接入配置','dingtalk-guide':'钉钉配置 / 使用说明'} as any)[activeView]+' · 会议纪要';if(activeView==='dingtalk')loadDingTalk().catch(e=>toast(e.message,'error'));if(activeView==='feishu')loadFeishu().catch(e=>toast(e.message,'error'));if(activeView==='settings')loadSettings().catch(e=>toast(e.message,'error'));}
async function bootLocal(){
  bindDingTalk();
  bindFeishu();
  qsa<HTMLElement>('[data-nav]').forEach(b=>b.onclick=()=>navigateLocal(b.dataset.nav!));
  qs<HTMLElement>('#newTask')!.onclick=newTask;qs<HTMLElement>('#morningMeetingUploadButton')!.onclick=openMorningMeetingUpload;
  qs<HTMLInputElement>('#taskSearch')!.oninput=()=>renderTodos(state.todos);qs<HTMLSelectElement>('#ownerFilter')!.onchange=()=>renderTodos(state.todos);
  qsa<HTMLElement>('[data-filter]').forEach(b=>b.onclick=()=>{taskFilter=b.dataset.filter!;qsa('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTodos(state.todos);});
  qs<HTMLFormElement>('#memberForm')!.onsubmit=async e=>{e.preventDefault();const f=e.currentTarget as HTMLFormElement,button=f.querySelector('button')!;button.disabled=true;try{await api('/api/members',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(f)))});f.reset();await refreshLocal();toast('成员已添加');}catch(e){toast((e as Error).message,'error');}finally{button.disabled=false;}};
  const configForm=qs<HTMLFormElement>('#settingsForm')!;
  const submitSettings=async(test:boolean)=>{if(!configForm.reportValidity())return;const body:any=Object.fromEntries(new FormData(configForm));for(const key of ['aiEnabled','clearKey','clearTranscriptionKey'])body[key]=(configForm.elements.namedItem(key) as HTMLInputElement).checked;const buttons=qsa<HTMLButtonElement>('button',configForm);buttons.forEach(b=>b.disabled=true);qs('#settingsResult')!.textContent=test?'正在测试连接…':'正在保存…';try{const result=await api('/api/settings'+(test?'/test':''),{method:test?'POST':'PUT',body:JSON.stringify(body)});qs('#settingsResult')!.textContent=test?result.message:'已保存，下一次解析将使用新配置。';if(!test)await loadSettings();}catch(e){qs('#settingsResult')!.textContent=(e as Error).message;}finally{buttons.forEach(b=>b.disabled=false);}};
  configForm.onsubmit=e=>{e.preventDefault();void submitSettings(false);};qs<HTMLElement>('#testAI')!.onclick=()=>void submitSettings(true);
  window.onhashchange=()=>{if(location.hash.slice(1)!==activeView)navigateLocal(location.hash.slice(1));};
  navigateLocal(location.hash.slice(1)||'dashboard');
  try{await refreshLocal();}catch(e){toast((e as Error).message,'error');}
}
