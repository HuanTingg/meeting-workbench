type LoginUser={id:string;memberId:string;username:string;name:string;role:'manager'|'head'|'department'|'region'|'store'|'member';regions?:string[];storeIds?:string[];departments?:string[];permissions?:Record<string,boolean>};
const roleNames:Record<string,string>={manager:'系统管理员',head:'总部负责人',department:'部门负责人',region:'大区负责人',store:'门店负责人',member:'普通成员'};
function businessLead(){return !!currentUser&&currentUser.role!=='member';}
function canManageStore(id?:string){if(['manager','head'].includes(currentUser?.role||''))return true;const s=stores.find(s=>s.id===id);return !!s&&(currentUser?.role==='region'&&!!currentUser.regions?.includes(s.region)||currentUser?.role==='store'&&!!currentUser.storeIds?.includes(s.id));}
function canEditMeetingUi(m:MorningMeeting){return (currentUser?.role==='manager'||currentUser?.permissions?.edit!==false)&&(m.uploadedBy===currentUser?.memberId||canManageStore(m.storeId)||currentUser?.role==='department'&&!!currentUser.departments?.includes((m as any).department));}
let currentUser:LoginUser|null=null;
let accountRows:Array<LoginUser&{disabled:boolean}>=[];
async function bootAuth(){
  const login=qs<HTMLFormElement>('#loginForm')!;
  login.onsubmit=async e=>{e.preventDefault();const button=login.querySelector('button')!;button.disabled=true;try{await api('/api/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(login)))});location.reload();}catch(e){qs('#loginError')!.textContent=(e as Error).message;}finally{button.disabled=false;}};
  try{const result=await api('/api/auth/me');currentUser=result.user;}catch(e){qs('#loginError')!.textContent=(e as Error).message;return;}
  if(!currentUser)return;
  qs<HTMLElement>('#loginPage')!.hidden=true;
  document.body.classList.add('signed-in');document.body.dataset.role=currentUser.role==='manager'?'manager':'member';
  qs('#sessionName')!.textContent=currentUser.name+' · '+roleNames[currentUser.role];
  qs<HTMLButtonElement>('#logout')!.onclick=async()=>{await api('/api/auth/logout',{method:'POST',body:'{}'});location.reload();};
  qs<HTMLButtonElement>('#changePassword')!.onclick=()=>passwordModal();
  if(currentUser.role==='member'){
    qs('#dashboard h1')!.textContent='任务派发';
    qs('.morning-meeting-head p')!.textContent='查看所有已发布会议，上传并管理自己的会议。';
    qs('#dashboard .dash-eyebrow')!.textContent='会议协同 / 我的工作台';
  }
  await bootLocal();
}
function passwordModal(){
  openModal('修改我的密码',`<form id="passwordForm" class="form-grid"><label class="form-field full">当前密码<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></label><label class="form-field full">新密码<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><label class="form-field full">确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><p id="passwordError" class="ding-error"></p></form>`,`<button class="btn primary" form="passwordForm">保存并重新登录</button>`);
  qs<HTMLFormElement>('#passwordForm')!.onsubmit=async e=>{e.preventDefault();const f=e.currentTarget as HTMLFormElement;const b=Object.fromEntries(new FormData(f));if(b.password!==b.confirmPassword){qs('#passwordError')!.textContent='两次密码不一致';return;}try{await api('/api/auth/password',{method:'POST',body:JSON.stringify(b)});location.reload();}catch(e){qs('#passwordError')!.textContent=(e as Error).message;}};
}
async function editMemberAccount(memberId:string){
  const member=members.find(m=>m.id===memberId)!;const old=accountRows.find(a=>a.memberId===memberId);
  openModal((old?'管理账号 · ':'分配账号 · ')+member.name,`<form id="accountForm" class="form-grid"><label class="form-field full">登录账号<input name="username" required pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,39}" maxlength="40" value="${escapeHtml(old?.username||'')}" autocomplete="off"><small>3–40位字母、数字、下划线、点或连字符</small></label><label class="form-field">系统角色<select name="role">${Object.entries(roleNames).map(([role,label])=>`<option value="${role}" ${(old?.role||'member')===role?'selected':''}>${label}</option>`).join('')}</select></label><label class="form-field">${old?'重置密码（留空保留）':'初始密码'}<input name="password" type="password" minlength="8" maxlength="128" ${old?'':'required'} autocomplete="new-password"></label><section class="full account-scope"><h3>账号可管理范围</h3><p id="accountScopeSummary"></p><details id="accountScopeDetails"><summary>调整管理范围 / 兼管设置</summary><div id="accountScopeFields"></div></details><p class="ui-note">新设置按人员归属带出，保存后生效；调店不会自动改变已有账号权限。</p></section><div class="full">操作权限${Object.entries({view:'查看',upload:'上传',dispatch:'派单',edit:'修改',review:'验收',export:'导出与下载'}).map(([key,label])=>`<label class="check-label"><input type="checkbox" name="permission_${key}" ${(old?.permissions?.[key]??(key!=='dispatch'||(old?.role||'member')!=='member'))?'checked':''}>${label}</label>`).join('')}</div><label class="check-label"><input name="disabled" type="checkbox" ${old?.disabled?'checked':''}>停用账号</label><p class="full ui-note">岗位、直属负责人及实际门店归属在“人员资料”中维护。修改账号会使原登录失效。</p><p id="accountError" class="ding-error"></p></form>`,'<button class="btn" data-modal-close>取消</button><button class="btn primary" form="accountForm">保存账号</button>');
  const form=qs<HTMLFormElement>('#accountForm')!,roleSelect=form.elements.namedItem('role') as HTMLSelectElement;
  const scopeDrafts:Record<string,string[]>={};
  const renderScope=()=>{
    const role=roleSelect.value,shop=stores.find(s=>s.id===member.storeId),own=role==='region'?[shop?.region||member.region||'']:role==='store'?[member.storeId||'']:[member.department||''];
    const saved=role==='region'?old?.regions:role==='store'?old?.storeIds:old?.departments;
    const selected=scopeDrafts[role]||(scopeDrafts[role]=old?.role===role?[...(saved||[])]:own.filter(Boolean));
    const field=role==='region'?'regions':role==='store'?'storeIds':'departments',label=role==='region'?'可管理大区':role==='store'?'可管理门店':'可管理部门';
    const scoped=['region','store','department'].includes(role),details=qs<HTMLDetailsElement>('#accountScopeDetails')!,fields=qs('#accountScopeFields')!;
    details.hidden=!scoped;details.open=scoped&&!selected.length;
    fields.innerHTML=!scoped?'':role==='department'?`<label class="form-field">${label}<input name="departments" value="${escapeHtml(selected.join('，'))}" placeholder="多个部门用逗号分隔"></label>`:`<label class="form-field">${label}<select name="${field}" multiple>${(role==='region'?[...new Set(stores.map(s=>s.region))].map(r=>({id:r,name:r})):stores.map(s=>({id:s.id,name:s.region+' / '+s.name}))).map(o=>`<option value="${escapeHtml(o.id)}" ${selected.includes(o.id)?'selected':''}>${escapeHtml(o.name)}</option>`).join('')}</select></label><p class="ui-note">按住 Ctrl（Mac 使用 Command）可选择多个。</p>`;
    const summary=()=>{qs('#accountScopeSummary')!.textContent=!scoped?(role==='manager'?'全公司；系统管理员拥有全部操作权限。':role==='head'?'全公司。':'本人相关任务；会议按系统的可见范围规则展示。'):selected.length?label+'：'+selected.map(v=>role==='store'?storeName(v):v).join('、'):'人员资料尚未提供可用归属，请在下方指定管理范围。';};
    const input=fields.querySelector<HTMLInputElement|HTMLSelectElement>('input,select');if(input)input.onchange=()=>{selected.splice(0,selected.length,...(input instanceof HTMLSelectElement?Array.from(input.selectedOptions).map(o=>o.value):input.value.split(/[,，]/).map(v=>v.trim()).filter(Boolean)));summary();};summary();
  };
  roleSelect.onchange=renderScope;renderScope();
  qs<HTMLFormElement>('#accountForm')!.onsubmit=async e=>{e.preventDefault();const f=e.currentTarget as HTMLFormElement;const b={...Object.fromEntries(new FormData(f)),departments:String(new FormData(f).get('departments')||'').split(/[,，]/).map(x=>x.trim()).filter(Boolean),permissions:Object.fromEntries(['view','upload','dispatch','edit','review','export'].map(k=>[k,(f.elements.namedItem('permission_'+k) as HTMLInputElement).checked])),regions:new FormData(f).getAll('regions'),storeIds:new FormData(f).getAll('storeIds'),disabled:(f.elements.namedItem('disabled') as HTMLInputElement).checked};try{await api('/api/accounts/'+memberId,{method:'PUT',body:JSON.stringify(b)});if(old?.id===currentUser?.id){location.reload();return;}closeModal();await refreshLocal();toast('账号已保存，请将账号和初始密码交给本人。');}catch(e){qs('#accountError')!.textContent=(e as Error).message;}};
}
function completionHistory(t:Todo){return (t.completions||[]).slice().reverse().map(c=>`<div class="completion-record"><b>${c.status==='pending_review'?'提交验收':c.done?'已完成':'重新打开'}</b><small>${escapeHtml(c.actorName)} · ${escapeHtml(new Date(c.at).toLocaleString('zh-CN'))}</small><p>${escapeHtml(c.note||'未填写说明')}</p>${c.attachment?`<a href="/api/todos/${encodeURIComponent(t.id)}/attachments/${encodeURIComponent(c.attachment.id)}">下载证明：${escapeHtml(c.attachment.name)}（${Math.ceil(c.attachment.size/1024)} KB）</a>`:'<small>未上传附件</small>'}</div>`).join('')||'<p>暂无完成反馈</p>';}
function completeTask(t:Todo){
  openModal(t.reviewerId?'提交验收':'完成待办',`<h3>${escapeHtml(t.title)}</h3><form id="completionForm" class="form-grid"><label class="form-field full">完成说明（选填）<textarea name="note" maxlength="2000" placeholder="说明完成情况或交付结果"></textarea></label><label class="form-field full">完成证明（选填）<input id="completionFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"><small>可不上传附件；提交后由指定验收人确认。单个附件不超过10MB，支持图片、PDF、Office、TXT、ZIP。</small></label><p id="completionError" class="ding-error"></p></form>`,'<button class="btn" data-modal-close>取消</button><button class="btn primary" id="completeSubmit" form="completionForm">提交完成情况</button>');
  qs<HTMLFormElement>('#completionForm')!.onsubmit=async e=>{e.preventDefault();const f=e.currentTarget as HTMLFormElement;const button=qs<HTMLButtonElement>('#completeSubmit')!;button.disabled=true;button.textContent='正在提交…';try{const file=qs<HTMLInputElement>('#completionFile')!.files?.[0];if(file&&file.size>10*1024*1024)throw Error('附件不能超过10MB');let attachment;
    if(file){const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('读取附件失败'));reader.readAsDataURL(file);});attachment={name:file.name,base64};}
    await api('/api/todos/'+t.id,{method:'PATCH',body:JSON.stringify({done:true,note:new FormData(f).get('note'),attachment})});closeModal();await refreshLocal();toast(t.reviewerId?'完成情况已提交，等待验收。':'完成情况已提交。');
  }catch(e){qs('#completionError')!.textContent=(e as Error).message;button.disabled=false;button.textContent='确认完成';}};
}

function taskDetailCard(title:string,body:string,tone='blue'){return `<section class="task-detail-card tone-${tone}"><h3>${escapeHtml(title)}</h3><div class="task-detail-content">${body}</div></section>`;}
function taskDisplayDate(value?:string){if(!value)return '未设置';if(!value.includes('T'))return value;const d=new Date(value);return Number.isNaN(d.getTime())?value:d.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});}
function taskWorkflow(t:Todo){
  const labels:Record<string,string>={configured:'确认任务资料',accept:'接单确认',return:'退回补充',redispatch:'补充后重派',block:'记录阻塞',unblock:'解除阻塞',handoff:'发起交接',acknowledge:'确认交付',dispatch:'审核派单',progress:'处理进展',transfer:'任务转移',submit:'提交完成',approve:'验收通过',reject:'验收退回',reopen:'重新打开'};
  const timeline=(t.timeline||[]).map(e=>`<div class="completion-record"><b>${escapeHtml(labels[e.action]||e.action)}</b><small>${escapeHtml(e.actorName)} · ${escapeHtml(new Date(e.at).toLocaleString('zh-CN'))}</small><p>${escapeHtml(e.note)}${e.previousOwnerId?' · '+escapeHtml(memberName(e.previousOwnerId))+' → '+escapeHtml(memberName(e.ownerId||'')):''}</p></div>`).join('');
  const canEdit=(currentUser?.role==='manager'||currentUser?.permissions?.edit!==false)&&(canManageStore(t.storeId)||[t.ownerId,t.dispatchedBy].includes(currentUser?.memberId||''));
  const canReview=t.status==='pending_review'&&t.reviewerId===currentUser?.memberId&&(currentUser?.role==='manager'||currentUser?.permissions?.review!==false);
  const status=t.status||(t.done?'completed':'in_progress');
  openModal('任务详情',`<div class="task-detail-layout"><section class="task-detail-summary"><div class="task-detail-title"><h2>${escapeHtml(t.title)}</h2><span class="task-status status-${escapeHtml(status)}">${workLabel(status)}</span></div>${t.description?`<p class="task-description">${escapeHtml(t.description)}</p>`:''}<dl class="task-detail-facts"><div><dt>执行人</dt><dd>${escapeHtml(memberName(t.ownerId))}</dd></div><div><dt>验收人</dt><dd>${escapeHtml(memberName(t.reviewerId||''))}</dd></div><div><dt>截止时间</dt><dd>${escapeHtml(taskDisplayDate(t.dueAt))}</dd></div><div><dt>所属门店</dt><dd>${escapeHtml(storeName(t.storeId))}</dd></div></dl></section>${taskDetailCard('任务来源',t.sourceExcerpt?`<blockquote>${escapeHtml(t.sourceExcerpt)}</blockquote>`:'<p class="task-empty">手动创建的任务</p>')}${taskDetailCard('处理时间轴',timeline?`<div class="task-timeline">${timeline}</div>`:'<p class="task-empty">暂无过程记录，记录进展后将在这里显示。</p>')}${taskDetailCard('完成证明',t.completions?.length?completionHistory(t):'<p class="task-empty">尚未提交完成情况，提交后的说明和附件将在这里显示。</p>','green')}<div id="taskCollaboration"></div></div>`,
    `<button class="btn" data-modal-close>关闭</button>${t.issueId?'<button class="btn" id="taskIssue">所属问题 / 关闭进度</button>':''}${t.meetingId?'<button class="btn" id="taskSource">定位原文</button>':''}${!t.done&&(!t.reviewerId||!t.storeId)&&businessLead()?'<button class="btn" id="taskConfigure">确认归属与验收人</button>':''}${canEdit&&!t.done&&!['pending_review','pending_acceptance','returned','blocked'].includes(t.status||'')?'<button class="btn" id="taskProgressNote">记录进展</button><button class="btn" id="taskTransfer">转移任务</button><button class="btn primary" id="taskComplete">提交完成</button>':''}${canReview?'<button class="btn" id="taskReject">退回处理</button><button class="btn primary" id="taskApprove">验收通过</button>':''}`);
  qs('#taskIssue')?.addEventListener('click',()=>void showIssue(t.issueId!));qs('#taskConfigure')?.addEventListener('click',()=>configureFlowTask(t));
  qs('#taskSource')?.addEventListener('click',()=>void locateMeetingSource(t.meetingId!,t.sourceExcerpt||''));
  qs('#taskComplete')?.addEventListener('click',()=>completeTask(t));
  const action=(kind:string)=>{
    const title=({progress:'记录进展',transfer:'转移任务',approve:'验收通过',reject:'退回处理'} as Record<string,string>)[kind];
    openModal(title,`<form id="taskActionForm" class="form-grid">${kind==='transfer'?`<label class="form-field full">新负责人<select name="ownerId" required>${memberOptions()}</select></label>`:''}<label class="form-field full">${kind==='transfer'?'转移原因':kind==='reject'?'退回原因':'说明'}<textarea name="note" maxlength="2000" ${kind!=='approve'?'required':''}></textarea></label><p id="taskActionError" role="alert"></p></form>`,`<button class="btn" data-modal-close>取消</button><button class="btn primary" form="taskActionForm">确认</button>`);
    qs<HTMLFormElement>('#taskActionForm')!.onsubmit=async e=>{e.preventDefault();const form=e.currentTarget as HTMLFormElement;const button=qs<HTMLButtonElement>('[form="taskActionForm"]')!;button.disabled=true;try{await api('/api/todos/'+t.id,{method:'PATCH',body:JSON.stringify({action:kind,...Object.fromEntries(new FormData(form))})});closeModal();await refreshLocal();toast(title+'已保存');}catch(error){qs('#taskActionError')!.textContent=(error as Error).message;button.disabled=false;}};
  };
  qs('#taskProgressNote')?.addEventListener('click',()=>action('progress'));qs('#taskTransfer')?.addEventListener('click',()=>action('transfer'));qs('#taskApprove')?.addEventListener('click',()=>action('approve'));qs('#taskReject')?.addEventListener('click',()=>action('reject'));
}
async function locateMeetingSource(id:string,excerpt:string,start?:number){
  await openMorningMeetingReview(id);
  const audio=qs<HTMLAudioElement>('#morningAudioPlayer');const m=morningMeetings.find(m=>m.id===id);const point=start??m?.transcriptSegments?.find(s=>s.text.includes(excerpt)&&!!excerpt)?.start;if(audio&&point!==undefined){audio.currentTime=point;audio.scrollIntoView({block:'center'});}
  const input=qs<HTMLTextAreaElement>('#morningTranscript');
  if(input&&excerpt){const start=input.value.indexOf(excerpt);if(start>=0){const details=input.closest('details');if(details)details.open=true;input.disabled=false;input.readOnly=true;input.focus();input.setSelectionRange(start,start+excerpt.length);input.scrollIntoView({block:'center'});}}
}

type StoreInfo={id:string;name:string;region:string;ownerId:string;status?:string;address?:string};
let stores:StoreInfo[]=[];
function storeName(id?:string){return stores.find(s=>s.id===id)?.name||'未关联门店';}
function storeOptions(){return stores.map(s=>`<option value="${s.id}">${escapeHtml(s.region+' / '+s.name)}</option>`).join('')+'<option value="" selected>未关联门店</option>';}
let appliedMeetingFilters:Record<string,string>={};
function captureMeetingFilters(){qsa<HTMLInputElement|HTMLSelectElement>('#meetingFilters input,#meetingFilters select').forEach(el=>appliedMeetingFilters[el.id]=el.value);}
function filteredMeetings(){
  const value=(id:string)=>appliedMeetingFilters[id]||'';
  const q=value('meetingQuery').trim().toLowerCase(),meetingType=value('meetingTypeFilter'),from=value('meetingFrom'),to=value('meetingTo');
  return morningMeetings.filter(m=>{const s=stores.find(s=>s.id===m.storeId);return (!meetingType||(m as any).meetingType===meetingType)&&(!q||(m.title+' '+m.transcript+' '+m.summary+' '+m.tasks.map(t=>t.title).join(' ')).toLowerCase().includes(q))&&(!from||m.meetingDate>=from)&&(!to||m.meetingDate<=to)&&(!value('meetingStoreFilter')||m.storeId===value('meetingStoreFilter'))&&(!value('meetingRegionFilter')||s?.region===value('meetingRegionFilter'))&&(!value('meetingOwnerFilter')||s?.ownerId===value('meetingOwnerFilter'));});
}
function setupMeetingFilters(){
  if(qs('#meetingFilters'))return;
  const host=qs('#morningMeetingRows');if(!host)return;
  const start=new Date(localDay()+'T12:00:00+08:00');start.setDate(start.getDate()-2);const from=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(start);
  const panel=document.createElement('section');panel.id='meetingFilters';panel.className='panel local-settings';
  panel.innerHTML=`<div class="form-grid"><label class="form-field">搜索会议及原文<input id="meetingQuery" placeholder="事项、标题或原文关键词"></label><label class="form-field">大区<select id="meetingRegionFilter"><option value="">全部大区</option>${[...new Set(stores.map(s=>s.region))].map(r=>`<option>${escapeHtml(r)}</option>`).join('')}</select></label><label class="form-field">门店<select id="meetingStoreFilter"><option value="">全部门店</option>${stores.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}</select></label><label class="form-field">门店负责人<select id="meetingOwnerFilter"><option value="">全部负责人</option>${members.map(m=>`<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select></label><label class="form-field">会议类型<input id="meetingTypeFilter" placeholder="如：门店例会"></label><label class="form-field">起始日期<input id="meetingFrom" type="date" value="${from}"></label><label class="form-field">截止日期<input id="meetingTo" type="date" value="${localDay()}"></label><div class="meeting-filter-actions"><button type="button" class="btn primary" id="applyMeetingFilters">筛选</button><button type="button" class="btn" id="clearMeetingFilters">清空筛选</button><span class="ui-note">默认近三天，清空可查看全部。</span></div></div><div id="frequentIssues"></div>`;
  const list=host.parentElement!;list.parentElement!.insertBefore(panel,list);
  const apply=()=>{const from=qs<HTMLInputElement>('#meetingFrom')!.value,to=qs<HTMLInputElement>('#meetingTo')!.value;if(from&&to&&from>to){toast('起始日期不能晚于截止日期','error');return;}captureMeetingFilters();renderMorningMeetings();};
  qs('#applyMeetingFilters')!.onclick=apply;qs('#clearMeetingFilters')!.onclick=()=>{qsa<HTMLInputElement|HTMLSelectElement>('input,select',panel).forEach(el=>el.value='');apply();};
  const updateStores=()=>{const region=qs<HTMLSelectElement>('#meetingRegionFilter')!.value,select=qs<HTMLSelectElement>('#meetingStoreFilter')!,selected=select.value;select.innerHTML='<option value="">全部门店</option>'+stores.filter(s=>!region||s.region===region).map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');select.value=selected;if(select.selectedIndex<0)select.value='';};
  qs('#meetingRegionFilter')!.onchange=updateStores;qs('#clearMeetingFilters')!.addEventListener('click',updateStores);captureMeetingFilters();
  panel.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();apply();}});renderFrequentIssues();
}
let repetitionRequest=0;
async function renderFrequentIssues(){
 const host=qs('#frequentIssues');if(!host)return;const request=++repetitionRequest;
 try{const r=await api('/api/workspace/repetition',{method:'POST',body:JSON.stringify({meetingIds:filteredMeetings().map(m=>m.id)})});if(request!==repetitionRequest)return;
 const row=(i:any)=>`<div class="completion-record"><b>${safe(i.title)}</b><p>${i.count} 场会议 · ${safe(workLabel(i.status))}${i.recurrences?' · 复发 '+i.recurrences+' 次':''}</p><p>首次提出 ${safe(i.firstDate)} · 最近跟进 ${safe(i.lastDate)} · ${safe(i.storeIds.map(storeName).join('、')||'未关联门店')}</p><button class="btn" data-repeated-issue="${i.id}">查看问题与跟进记录</button></div>`;
 const expanded=qs<HTMLDetailsElement>('#meetingInsights')?.open;
 host.innerHTML=`<details id="meetingInsights" ${expanded?'open':''}><summary>问题与待办核对 <span>${r.repeated.length} 项重复提及 · ${r.duplicates.length} 组同日疑似重复</span></summary>`+'<h3>重复提及的问题</h3><p>按已关联的同一问题统计筛选范围内会议，排除例行待办；首次、最近日期为当前范围内记录。</p>'+(r.repeated.map(row).join('')||'<p>当前范围暂无已关联的重复提及问题。</p>')+'<h3>同日疑似重复待办</h3><p>按门店、事项、执行日期核对；未填执行日期时采用截止日期。仅提示，不合并、不删除。</p>'+(r.duplicates.map((d:any)=>`<p>${safe(d.title)} · ${safe(storeName(d.storeId))} · ${safe(d.date)} · ${d.taskIds.length} 条 ${d.taskIds.map((id:string,n:number)=>`<button class="btn" data-duplicate-task="${id}">核对待办 ${n+1}</button>`).join('')}</p>`).join('')||'<p>当前范围暂无同日疑似重复待办。</p>')+'</details>';
 const cross=qs('#crossStoreIssues');if(cross)cross.innerHTML='<h2>跨门店关联问题</h2><p>仅展示“会议转写”筛选范围内、已关联到同一问题的多门店会议。</p>'+(r.repeated.filter((i:any)=>i.storeIds.length>1).map(row).join('')||'<p>当前范围暂无跨门店关联问题。</p>');
 qsa<HTMLElement>('[data-repeated-issue]').forEach(b=>b.onclick=()=>void showIssue(b.dataset.repeatedIssue!));qsa<HTMLElement>('[data-duplicate-task]').forEach(b=>b.onclick=()=>{const t=state.todos.find(t=>t.id===b.dataset.duplicateTask);if(t)showWorkTask(t);});
 }catch(e){if(request===repetitionRequest)host.innerHTML='<p>问题统计暂时无法加载，请重新筛选。</p>';}
}
function renderOperations(){
  let search=qs('#meetingAssistant');if(!search){search=document.createElement('section');search.id='meetingAssistant';search.className='panel local-settings';qs('#assistant')!.append(search);}
  search.innerHTML='<h2>会议助手 · 事项查询</h2><p>搜索有权查看的任务和会议原文，查询实际完成状态。</p><input id="assistantQuery" placeholder="输入事项关键词"><div id="assistantResults"></div>';
  qs<HTMLInputElement>('#assistantQuery')!.oninput=e=>{const q=(e.target as HTMLInputElement).value.trim().toLowerCase();const out=qs('#assistantResults')!;if(!q){out.innerHTML='';return;}
    const todos=state.todos.filter(t=>(t.title+' '+(t.description||'')).toLowerCase().includes(q));const meetings=morningMeetings.filter(m=>(m.title+' '+m.transcript).toLowerCase().includes(q));
    out.innerHTML=todos.slice(0,20).map(t=>`<p><button class="btn" data-result-task="${t.id}">${escapeHtml(t.title)}</button> · ${workLabel(t.status||(t.done?'completed':'in_progress'))} · ${escapeHtml(memberName(t.ownerId))}</p>`).join('')+meetings.slice(0,20).map(m=>`<p><button class="btn" data-result-meeting="${m.id}">${escapeHtml(m.title)} · 定位原文</button></p>`).join('')||'<p>未找到匹配记录</p>';
    qsa<HTMLElement>('[data-result-task]',out).forEach(b=>b.onclick=()=>taskWorkflow(state.todos.find(t=>t.id===b.dataset.resultTask)!));qsa<HTMLElement>('[data-result-meeting]',out).forEach(b=>b.onclick=()=>{const m=morningMeetings.find(m=>m.id===b.dataset.resultMeeting)!;const index=m.transcript.toLowerCase().indexOf(q);void locateMeetingSource(m.id,index>=0?m.transcript.slice(index,index+q.length):'');});
  };
  let stats=qs('#storeStatistics');if(!stats){stats=document.createElement('section');stats.id='storeStatistics';stats.className='panel local-settings';qs('#analytics')!.append(stats);}
  stats.innerHTML='<h2>门店会议统计</h2><p>按当前账号可查看的全部会议与任务统计。</p>'+stores.map(s=>{const tasks=state.todos.filter(t=>t.storeId===s.id);return `<p><b>${escapeHtml(s.region+' / '+s.name)}</b> · ${morningMeetings.filter(m=>m.storeId===s.id).length} 场会议 · ${tasks.length} 项任务 · ${tasks.filter(t=>t.status==='pending_review').length} 项待验收 · ${tasks.filter(t=>t.done).length} 项已完成</p>`;}).join('');
  const drafts=qs('#preparationRows');if(drafts){drafts.innerHTML=morningMeetings.filter(m=>m.status==='review').map(m=>`<div class="completion-record"><b>${escapeHtml(m.title)}</b><p>${escapeHtml(meetingUnitName(m))} · ${m.tasks.filter(t=>t.status!=='ignored').length} 项待确认</p><button class="btn" data-prepare="${m.id}">核对责任人与验收人</button></div>`).join('')||'<p>暂无待审核会议；先上传并解析会议资料。</p>';qsa<HTMLElement>('[data-prepare]',drafts).forEach(b=>b.onclick=()=>void openMorningMeetingReview(b.dataset.prepare!));}
  let cross=qs('#crossStoreIssues');if(!cross){cross=document.createElement('section');cross.id='crossStoreIssues';cross.className='panel local-settings';qs('#preparation')!.append(cross);}
  setupPreparationTabs();renderFrequentIssues();
}

function setupMemberProfileForm(form:HTMLFormElement,selected?:string){
  const region=form.elements.namedItem('region') as HTMLInputElement,shop=form.elements.namedItem('storeId') as HTMLSelectElement;
  const update=()=>{const value=selected??shop.value;selected=undefined;shop.innerHTML='<option value="">未关联门店</option>'+stores.filter(s=>!region.value||s.region===region.value).map(s=>`<option value="${s.id}">${escapeHtml(s.region+' / '+s.name)}</option>`).join('');shop.value=value||'';if(shop.selectedIndex<0)shop.value='';};
  region.oninput=update;shop.onchange=()=>{const s=stores.find(s=>s.id===shop.value);if(s)region.value=s.region;};update();
}
async function editMemberProfile(id:string){chainMember(id);}
