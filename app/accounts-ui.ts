type LoginUser={id:string;memberId:string;username:string;name:string;role:'manager'|'member';mustChangePassword:boolean};
let currentUser:LoginUser|null=null;
let accountRows:Array<LoginUser&{disabled:boolean}>=[];
async function bootAuth(){
  const login=qs<HTMLFormElement>('#loginForm')!;
  login.onsubmit=async e=>{e.preventDefault();const button=login.querySelector('button')!;button.disabled=true;try{await api('/api/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(login)))});location.reload();}catch(e){qs('#loginError')!.textContent=(e as Error).message;}finally{button.disabled=false;}};
  try{const result=await api('/api/auth/me');currentUser=result.user;}catch(e){qs('#loginError')!.textContent=(e as Error).message;return;}
  if(!currentUser)return;
  qs<HTMLElement>('#loginPage')!.hidden=true;
  document.body.classList.add('signed-in');document.body.dataset.role=currentUser.role;
  qs('#sessionName')!.textContent=currentUser.name+' · '+(currentUser.role==='manager'?'负责人':'成员');
  qs<HTMLButtonElement>('#logout')!.onclick=async()=>{await api('/api/auth/logout',{method:'POST',body:'{}'});location.reload();};
  qs<HTMLButtonElement>('#changePassword')!.onclick=()=>passwordModal();
  if(currentUser.mustChangePassword){passwordModal(true);return;}
  if(currentUser.role==='member'){
    qs('#dashboard h1')!.textContent='任务总览';
    qs('.morning-meeting-head p')!.textContent='查看所有已发布会议，上传并管理自己的会议。';
    qs('#dashboard .focus-title h2')!.textContent='跟进我的任务，记录每一次完成';
    qs('#dashboard .focus-title p')!.textContent='查看分配给你的任务，完成时可补充说明和证明附件。';
  }
  await bootLocal();
}
function passwordModal(required=false){
  openModal(required?'首次登录，请修改初始密码':'修改我的密码',`<form id="passwordForm" class="form-grid"><label class="form-field full">当前密码<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></label><label class="form-field full">新密码<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><label class="form-field full">确认新密码<input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label><p id="passwordError" class="ding-error"></p></form>`,`<button class="btn primary" form="passwordForm">保存并重新登录</button>`);
  if(required)qsa<HTMLElement>('[data-modal-close]').forEach(b=>b.remove());
  qs<HTMLFormElement>('#passwordForm')!.onsubmit=async e=>{e.preventDefault();const f=e.currentTarget as HTMLFormElement;const b=Object.fromEntries(new FormData(f));if(b.password!==b.confirmPassword){qs('#passwordError')!.textContent='两次密码不一致';return;}try{await api('/api/auth/password',{method:'POST',body:JSON.stringify(b)});location.reload();}catch(e){qs('#passwordError')!.textContent=(e as Error).message;}};
}
async function editMemberAccount(memberId:string){
  const member=members.find(m=>m.id===memberId)!;const old=accountRows.find(a=>a.memberId===memberId);
  openModal((old?'管理账号 · ':'分配账号 · ')+member.name,`<form id="accountForm" class="form-grid"><label class="form-field full">登录账号<input name="username" required pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,39}" maxlength="40" value="${escapeHtml(old?.username||'')}" autocomplete="off"><small>3–40位字母、数字、下划线、点或连字符</small></label><label class="form-field">角色<select name="role"><option value="member" ${old?.role!=='manager'?'selected':''}>普通成员 · 仅自己的待办</option><option value="manager" ${old?.role==='manager'?'selected':''}>负责人 · 全部待办与账号管理</option></select></label><label class="form-field">${old?'重置密码（留空保留）':'初始密码'}<input name="password" type="password" minlength="8" maxlength="128" ${old?'':'required'} autocomplete="new-password"></label><label class="check-label"><input name="disabled" type="checkbox" ${old?.disabled?'checked':''}>停用账号</label><p>新建或重置密码后，该成员需要在下次登录时修改密码。修改账号会使原登录失效。</p><p id="accountError" class="ding-error"></p></form>`,'<button class="btn" data-modal-close>取消</button><button class="btn primary" form="accountForm">保存账号</button>');
  qs<HTMLFormElement>('#accountForm')!.onsubmit=async e=>{e.preventDefault();const f=e.currentTarget as HTMLFormElement;const b={...Object.fromEntries(new FormData(f)),disabled:(f.elements.namedItem('disabled') as HTMLInputElement).checked};try{await api('/api/accounts/'+memberId,{method:'PUT',body:JSON.stringify(b)});if(old?.id===currentUser?.id){location.reload();return;}closeModal();await refreshLocal();toast('账号已保存，请将账号和初始密码交给本人。');}catch(e){qs('#accountError')!.textContent=(e as Error).message;}};
}
function completionHistory(t:Todo){return (t.completions||[]).slice().reverse().map(c=>`<div class="completion-record"><b>${c.done?'已完成':'重新打开'}</b><small>${escapeHtml(c.actorName)} · ${escapeHtml(new Date(c.at).toLocaleString('zh-CN'))}</small><p>${escapeHtml(c.note||'未填写说明')}</p>${c.attachment?`<a href="/api/todos/${encodeURIComponent(t.id)}/attachments/${encodeURIComponent(c.attachment.id)}">下载证明：${escapeHtml(c.attachment.name)}（${Math.ceil(c.attachment.size/1024)} KB）</a>`:'<small>未上传附件</small>'}</div>`).join('')||'<p>暂无完成反馈</p>';}
function completeTask(t:Todo){
  openModal('完成待办',`<h3>${escapeHtml(t.title)}</h3><form id="completionForm" class="form-grid"><label class="form-field full">完成说明（选填）<textarea name="note" maxlength="2000" placeholder="说明完成情况或交付结果"></textarea></label><label class="form-field full">完成证明（选填）<input id="completionFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip"><small>可直接完成，无需上传附件。单个附件不超过10MB，支持图片、PDF、Office、TXT、ZIP。</small></label><p id="completionError" class="ding-error"></p></form>`,'<button class="btn" data-modal-close>取消</button><button class="btn primary" id="completeSubmit" form="completionForm">确认完成</button>');
  qs<HTMLFormElement>('#completionForm')!.onsubmit=async e=>{e.preventDefault();const f=e.currentTarget as HTMLFormElement;const button=qs<HTMLButtonElement>('#completeSubmit')!;button.disabled=true;button.textContent='正在提交…';try{const file=qs<HTMLInputElement>('#completionFile')!.files?.[0];if(file&&file.size>10*1024*1024)throw Error('附件不能超过10MB');let attachment;
    if(file){const base64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('读取附件失败'));reader.readAsDataURL(file);});attachment={name:file.name,base64};}
    await api('/api/todos/'+t.id,{method:'PATCH',body:JSON.stringify({done:true,note:new FormData(f).get('note'),attachment})});closeModal();await refreshLocal();toast('完成情况已提交，负责人可以查看。');
  }catch(e){qs('#completionError')!.textContent=(e as Error).message;button.disabled=false;button.textContent='确认完成';}};
}
