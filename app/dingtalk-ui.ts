async function loadDingTalk(){
  const [c,log,people]=await Promise.all([api('/api/dingtalk/config'),api('/api/dingtalk/notifications'),api('/api/members')]);
  members=people.members;
  const f=qs<HTMLFormElement>('#dingForm')!;
  for(const name of ['groupName','keyword','appKey','agentId'])(f.elements.namedItem(name) as HTMLInputElement).value=c[name];
  for(const name of ['groupEnabled','personalEnabled'])(f.elements.namedItem(name) as HTMLInputElement).checked=c[name];
  for(const [name,flag] of [['webhook','hasWebhook'],['signSecret','hasSignSecret'],['appSecret','hasAppSecret']]){const input=f.elements.namedItem(name) as HTMLInputElement;input.value='';input.placeholder=c[flag]?'已保存，留空保留':'尚未配置';}
  for(const name of ['clearWebhook','clearSignSecret','clearAppSecret'])(f.elements.namedItem(name) as HTMLInputElement).checked=false;
  qs('#dingTestMember')!.innerHTML=memberOptions();
  const statuses:any={pending:'等待发送',sending:'正在发送',accepted:'钉钉已受理',failed:'发送失败',unknown:'结果不确定'};
  qs('#dingLogs')!.innerHTML=log.notifications.length?log.notifications.map((n:any)=>`<article class="ding-log"><div><b>${escapeHtml(n.title)}</b><small>${n.channel==='group'?'群通知':'负责人工作通知'} · ${escapeHtml(n.recipient||memberName(n.ownerId))} · ${escapeHtml(n.createdAt.slice(0,19).replace('T',' '))} UTC${n.isTest?' · 测试':''}</small><p>${escapeHtml(statuses[n.status]||n.status)}${n.remoteTaskId?' · 发送任务 '+escapeHtml(n.remoteTaskId):''}</p>${n.error?`<p class="ding-error">${escapeHtml(n.error)}</p>`:''}<details><summary>查看发送内容</summary><pre>${escapeHtml(n.content)}</pre></details></div>${['failed','unknown'].includes(n.status)?`<button class="btn" data-ding-retry="${n.id}" data-uncertain="${n.status==='unknown'}">${n.status==='unknown'?'核实后重发':'重试'}</button>`:''}</article>`).join(''):'<div class="todo-history-empty">暂无发送记录。启用后，新会议任务发布时会自动通知。</div>';
  qsa<HTMLButtonElement>('[data-ding-retry]').forEach(b=>b.onclick=async()=>{const uncertain=b.dataset.uncertain==='true';if(uncertain&&!confirm('上次可能已发送成功。你已在钉钉核实未收到，确定再次发送？'))return;b.disabled=true;try{const r=await api('/api/dingtalk/notifications/'+b.dataset.dingRetry+'/retry',{method:'POST',body:JSON.stringify({confirmUnknown:uncertain})});toast(r.error||'钉钉已受理；不代表接收人已读',r.status==='accepted'?'success':'error');await loadDingTalk();}catch(e){toast((e as Error).message,'error');b.disabled=false;}});
}
function bindDingTalk(){
  const form=qs<HTMLFormElement>('#dingForm')!;
  form.onsubmit=async e=>{e.preventDefault();const b:any=Object.fromEntries(new FormData(form));for(const name of ['groupEnabled','personalEnabled','clearWebhook','clearSignSecret','clearAppSecret'])b[name]=(form.elements.namedItem(name) as HTMLInputElement).checked;const button=form.querySelector<HTMLButtonElement>('[type=submit]')!;button.disabled=true;try{await api('/api/dingtalk/config',{method:'PUT',body:JSON.stringify(b)});await loadDingTalk();toast('钉钉配置已保存；启用后仅通知新发布的会议任务。');}catch(e){toast((e as Error).message,'error');}finally{button.disabled=false;}};
  qsa<HTMLButtonElement>('[data-ding-test]').forEach(button=>button.onclick=async()=>{const channel=button.dataset.dingTest,ownerId=qs<HTMLSelectElement>('#dingTestMember')!.value;if(channel==='personal'&&!ownerId){toast('请选择测试接收成员','error');return;}if(!confirm('将使用已保存配置，真实发送一条测试通知到'+(channel==='group'?'配置的钉钉群':'所选成员的钉钉工作通知')+'，是否发送？'))return;button.disabled=true;try{const r=await api('/api/dingtalk/test',{method:'POST',body:JSON.stringify({channel,ownerId})});toast(r.error||'钉钉已受理测试通知；请到钉钉核实。',r.status==='accepted'?'success':'error');await loadDingTalk();}catch(e){toast((e as Error).message,'error');}finally{button.disabled=false;}});
  qs<HTMLElement>('#refreshDing')!.onclick=()=>loadDingTalk().catch(e=>toast(e.message,'error'));
}
function editDingMember(memberId:string){
  const member=members.find(m=>m.id===memberId)!;
  openModal('钉钉接收人 · '+member.name,`<form id="dingMemberForm"><label class="form-field">钉钉 userid<input name="dingtalkUserId" value="${escapeHtml(member.dingtalkUserId||'')}" maxlength="100" pattern="[A-Za-z0-9_.@-]+" placeholder="企业通讯录中的员工userid"></label><p>填写同一企业内的员工 userid，不是手机号或姓名；留空解除绑定。</p></form>`,'<button class="btn" data-modal-close>取消</button><button class="btn primary" form="dingMemberForm" type="submit">保存绑定</button>');
  qs<HTMLFormElement>('#dingMemberForm')!.onsubmit=async e=>{e.preventDefault();const b=Object.fromEntries(new FormData(e.currentTarget as HTMLFormElement));try{await api('/api/members/'+memberId,{method:'PATCH',body:JSON.stringify(b)});closeModal();await refreshLocal();toast('成员钉钉绑定已更新');}catch(e){toast((e as Error).message,'error');}};
}
