async function loadFeishu(){
  const [c,log,people]=await Promise.all([api('/api/feishu/config'),api('/api/feishu/notifications'),api('/api/members')]);
  members=people.members;
  const f=qs<HTMLFormElement>('#feiForm')!;
  for(const name of ['groupName','appId','chatId'])(f.elements.namedItem(name) as HTMLInputElement).value=c[name];
  for(const name of ['groupEnabled','personalEnabled'])(f.elements.namedItem(name) as HTMLInputElement).checked=c[name];
  for(const [name,flag] of [['appSecret','hasAppSecret']]){const input=f.elements.namedItem(name) as HTMLInputElement;input.value='';input.placeholder=c[flag]?'已保存，留空保留':'尚未配置';}
  for(const name of ['clearAppSecret'])(f.elements.namedItem(name) as HTMLInputElement).checked=false;
  qs('#feiTestMember')!.innerHTML=memberOptions();
  const statuses:any={pending:'等待发送',sending:'正在发送',accepted:'飞书已受理',failed:'发送失败',unknown:'结果不确定'};
  qs('#feiLogs')!.innerHTML=log.notifications.length?log.notifications.map((n:any)=>`<article class="ding-log"><div><b>${escapeHtml(n.title)}</b><small>${n.channel==='group'?'群通知':'负责人通知'} · ${escapeHtml(n.recipient||memberName(n.ownerId))} · ${escapeHtml(n.createdAt.slice(0,19).replace('T',' '))} UTC${n.isTest?' · 测试':''}</small><p>${escapeHtml(statuses[n.status]||n.status)}${n.remoteMessageId?' · 消息编号 '+escapeHtml(n.remoteMessageId):''}</p>${n.error?`<p class="ding-error">${escapeHtml(n.error)}</p>`:''}<details><summary>查看发送内容</summary><pre>${escapeHtml(n.content)}</pre></details></div>${['failed','unknown'].includes(n.status)?`<button class="btn" data-fei-retry="${n.id}" data-uncertain="${n.status==='unknown'}">${n.status==='unknown'?'核实后重发':'重试'}</button>`:''}</article>`).join(''):'<div class="todo-history-empty">暂无发送记录。启用后，新会议任务发布时会自动通知。</div>';
  qsa<HTMLButtonElement>('[data-fei-retry]').forEach(b=>b.onclick=async()=>{const uncertain=b.dataset.uncertain==='true';if(uncertain&&!confirm('上次可能已发送成功。你已在飞书核实未收到，确定再次发送？'))return;b.disabled=true;try{const r=await api('/api/feishu/notifications/'+b.dataset.feiRetry+'/retry',{method:'POST',body:JSON.stringify({confirmUnknown:uncertain})});toast(r.error||'飞书已受理；不代表接收人已读',r.status==='accepted'?'success':'error');await loadFeishu();}catch(e){toast((e as Error).message,'error');b.disabled=false;}});
}
function bindFeishu(){
  const form=qs<HTMLFormElement>('#feiForm')!;
  form.onsubmit=async e=>{e.preventDefault();const b:any=Object.fromEntries(new FormData(form));for(const name of ['groupEnabled','personalEnabled','clearAppSecret'])b[name]=(form.elements.namedItem(name) as HTMLInputElement).checked;const button=form.querySelector<HTMLButtonElement>('[type=submit]')!;button.disabled=true;try{await api('/api/feishu/config',{method:'PUT',body:JSON.stringify(b)});await loadFeishu();toast('飞书配置已保存；启用后仅通知新发布的会议任务。');}catch(e){toast((e as Error).message,'error');}finally{button.disabled=false;}};
  qsa<HTMLButtonElement>('[data-fei-test]').forEach(button=>button.onclick=async()=>{const channel=button.dataset.feiTest,ownerId=qs<HTMLSelectElement>('#feiTestMember')!.value;if(channel==='personal'&&!ownerId){toast('请选择测试接收成员','error');return;}if(!confirm('将使用已保存配置，真实发送一条测试通知到'+(channel==='group'?'配置的飞书群':'所选成员的飞书通知')+'，是否发送？'))return;button.disabled=true;try{const r=await api('/api/feishu/test',{method:'POST',body:JSON.stringify({channel,ownerId})});toast(r.error||'飞书已受理测试通知；请到飞书核实。',r.status==='accepted'?'success':'error');await loadFeishu();}catch(e){toast((e as Error).message,'error');}finally{button.disabled=false;}});
  qs<HTMLElement>('#refreshFei')!.onclick=()=>loadFeishu().catch(e=>toast(e.message,'error'));
}
async function editFeishuMember(memberId:string){
  try{
    const c=await api('/api/feishu/config');
    if(!c.appId){toast('请先在飞书配置中保存 App ID','error');navigateLocal('feishu');return;}
    const member=members.find(m=>m.id===memberId)!;
    const stale=!!member.feishuOpenId&&member.feishuAppId!==c.appId;
    openModal('飞书接收人 · '+member.name,`<form id="feiMemberForm"><label class="form-field">飞书 open_id<input name="feishuOpenId" value="${escapeHtml(stale?'':member.feishuOpenId||'')}" maxlength="100" pattern="ou_[A-Za-z0-9]+" placeholder="ou_…"></label><p>当前应用：${escapeHtml(c.appId)}。填写本应用获取的员工 open_id，留空解除绑定。</p>${stale?'<p class="ding-error">应用已更换，请重新获取并绑定员工 open_id。</p>':''}</form>`,'<button class="btn" data-modal-close>取消</button><button class="btn primary" form="feiMemberForm" type="submit">保存绑定</button>');
    qs<HTMLFormElement>('#feiMemberForm')!.onsubmit=async e=>{e.preventDefault();const b={...Object.fromEntries(new FormData(e.currentTarget as HTMLFormElement)),feishuAppId:c.appId};try{await api('/api/members/'+memberId,{method:'PATCH',body:JSON.stringify(b)});closeModal();await refreshLocal();toast('成员飞书绑定已更新');}catch(e){toast((e as Error).message,'error');}};
  }catch(e){toast((e as Error).message,'error');}
}
