import {randomUUID, createHash} from 'node:crypto';
const clean=(v,n=200)=>typeof v==='string'?v.trim().slice(0,n):'';
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const stamp=()=>new Date().toISOString();
const digest=v=>createHash('sha256').update(v).digest('hex');
// Never echo upstream text verbatim: it can contain credentials or personal identifiers.
export function feishuFailure(data,httpStatus,sending){
  const stage=sending?'发送消息':'获取应用令牌';
  const code=typeof data?.code==='number'&&Number.isFinite(data.code)?String(data.code):'未知';
  const message=typeof data?.msg==='string'?data.msg:'';
  const scopes=[...new Set(message.match(/\b(?:im|contact|application):[a-z_]+(?::[a-z_]+)?\b/g)||[])].slice(0,10);
  let hint=sending?'请检查发送消息权限、应用发布状态、接收编号及机器人是否已加入目标群。':'请核对同一应用的 App ID 和 App Secret。';
  if(/access denied|scope.*required|permission denied/i.test(message))hint=scopes.length?`应用缺少权限，请在飞书开发者后台开通所需权限并发布：${scopes.join('、')}。`:'应用权限不足，请在开发者后台检查应用身份权限并发布。';
  else if(/outside the group|not.*(?:in|member of).*chat/i.test(message))hint='机器人未加入目标群，请将此应用机器人添加到群，并核对群 chat_id。';
  else if(/bot ability.*not.*activat/i.test(message))hint='应用尚未启用机器人能力，请添加机器人能力并发布应用。';
  else if(/availability.*user|user.*availability/i.test(message))hint='接收人不在应用可用范围内，请在飞书后台调整可用范围并发布。';
  else if(/invalid.*(?:receive_id|chat_id)|(?:receive_id|chat_id).*invalid/i.test(message))hint='接收编号无效，请核对本应用对应的群 chat_id 或员工 open_id。';
  return error(`飞书${stage}失败（HTTP ${httpStatus}，错误码 ${code}）。${hint}`,502);
}
export function createFeishu(db,save,fetchImpl) {
  db.feishu={appId:'',appSecret:'',groupEnabled:false,personalEnabled:false,groupName:'会议通知群',chatId:'',...db.feishu};
  db.notifications??=[];
  const own=n=>n.provider==='feishu';
  for(const row of db.notifications.filter(own))if(row.status==='sending'){row.status='unknown';row.error='发送被中断，可能已到达飞书；请核实后决定是否重发。';}
  const config=()=>{const {appSecret,...rest}=db.feishu;return {...rest,hasAppSecret:!!appSecret};};
  async function configure(b) {
    const old=db.feishu,c={appId:clean(b.appId),groupEnabled:b.groupEnabled===true,personalEnabled:b.personalEnabled===true,groupName:clean(b.groupName)||'会议通知群',chatId:clean(b.chatId)};
    c.appSecret=b.clearAppSecret?'':clean(b.appSecret,1000)||(c.appId===old.appId?old.appSecret:'');
    if(c.appId&&!/^cli_[A-Za-z0-9]+$/.test(c.appId))throw error('App ID 应为 cli_ 开头的飞书应用编号');
    if(c.chatId&&!/^oc_[A-Za-z0-9]+$/.test(c.chatId))throw error('群 chat_id 应为 oc_ 开头的群编号');
    if((c.groupEnabled||c.personalEnabled)&&(!c.appId||!c.appSecret))throw error('启用通知需要填写 App ID 和 App Secret');
    if(c.groupEnabled&&!c.chatId)throw error('启用群通知需要填写群 chat_id');
    if(db.notifications.some(n=>own(n)&&n.status==='sending'))throw error('正在发送飞书通知，请稍后修改配置',409);
    db.feishu=c;await save();return config();
  }
  function append(channel,meetingId,ownerId,title,content,isTest=false){
    const key=isTest?randomUUID():`feishu:${meetingId}:${channel}:${ownerId||'group'}`;
    const prior=db.notifications.find(n=>own(n)&&n.key===key);if(prior)return prior;
    const row={id:'notice_'+randomUUID().replaceAll('-',''),provider:'feishu',key,channel,meetingId,ownerId,title,content,isTest,status:'pending',attempts:0,createdAt:stamp(),error:''};db.notifications.unshift(row);return row;
  }
  function enqueue(m){
    const tasks=db.todos.filter(t=>t.meetingId===m.id),headline=`会议任务｜${m.title}`;
    const body=list=>`${headline}\n会议日期：${m.meetingDate}\n\n`+list.map((t,i)=>`${i+1}. ${t.title}\n负责人：${db.members.find(p=>p.id===t.ownerId)?.name||'未指定'}\n截止：${t.dueAt||'未指定'}\n优先级：${({high:'高',medium:'中',normal:'普通'})[t.priority]||'普通'}`).join('\n\n');
    if(db.feishu.groupEnabled)append('group',m.id,'',headline,body(tasks));
    if(db.feishu.personalEnabled)for(const ownerId of new Set(tasks.map(t=>t.ownerId)))append('personal',m.id,ownerId,headline,body(tasks.filter(t=>t.ownerId===ownerId)));
  }
  function enqueueTodo(t) {
    const c=db.feishu,headline=`会议任务｜新增待办`;
    const content=`${headline}\n任务：${t.title}\n负责人：${db.members.find(m=>m.id===t.ownerId)?.name||'未指定'}\n截止：${t.dueAt||'未指定'}\n优先级：${({high:'高',medium:'中',normal:'普通'})[t.priority]||'普通'}${t.description?'\n执行说明：'+t.description:''}`;
    for(const channel of ['group','personal'])if(c[channel+'Enabled']){const row=append(channel,'manual:'+t.id,channel==='personal'?t.ownerId:'',headline,content);row.todoId=t.id;row.meetingId='';}
  }
  async function request(path,body,token='',sending=false){
    let r;try{r=await fetchImpl('https://open.feishu.cn/open-apis/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw Object.assign(error(sending?'网络超时或连接中断，发送结果不确定，请到飞书核实。':'获取飞书令牌失败，请检查网络。',502),{uncertain:sending});}
    let data;try{data=await r.json();}catch{throw Object.assign(error(`飞书${sending?'发送消息':'获取应用令牌'}接口 HTTP ${r.status}，响应无法解析。`,502),{uncertain:sending});}
    if(!r.ok||data?.code!==0)throw Object.assign(feishuFailure(data,r.status,sending),{uncertain:sending&&r.status>=500});
    return data;
  }
  async function send(row,allowUnknown=false){
    if(['accepted','sending'].includes(row.status))return row;
    if(row.status==='unknown'&&!allowUnknown)throw error('发送结果不确定；确认飞书中未收到后才能重发。',409);
    const c={...db.feishu};row.status='sending';row.attempts++;row.updatedAt=stamp();row.error='';await save();
    try{
      if(Buffer.byteLength(row.content,'utf8')>20000)throw error('通知内容过长，请拆分会议任务后发送。');
      if(!c.appId||!c.appSecret)throw error('飞书应用凭证尚未配置');
      let receiver,type;
      if(row.channel==='group'){
        if(!c.groupEnabled||!c.chatId)throw error('群通知未启用或未配置');
        receiver=c.chatId;type='chat_id';row.recipient=c.groupName;
      }else{
        if(!c.personalEnabled)throw error('个人通知未启用');
        const member=db.members.find(m=>m.id===row.ownerId);
        if(!member?.feishuOpenId)throw error('负责人未绑定飞书 open_id，请在成员管理中补充。');
        if(member.feishuAppId!==c.appId)throw error('负责人的飞书绑定属于其他应用，请重新绑定。');
        receiver=member.feishuOpenId;type='open_id';row.recipient=member.name;
      }
      const target=digest(c.appId+'|'+type+'|'+receiver);
      if(row.target&&row.target!==target)throw error('应用或接收目标已改变，为避免发错人或群，此记录不能重试。');
      row.target=target;await save();
      const auth=await request('auth/v3/tenant_access_token/internal',{app_id:c.appId,app_secret:c.appSecret});
      if(!auth.tenant_access_token)throw error('飞书未返回有效令牌',502);
      const result=await request('im/v1/messages?receive_id_type='+type,{receive_id:receiver,msg_type:'text',content:JSON.stringify({text:row.content}),uuid:row.id.slice(7)},auth.tenant_access_token,true);
      if(!result.data?.message_id)throw Object.assign(error('飞书未返回消息编号，结果待核实。',502),{uncertain:true});
      row.remoteMessageId=result.data.message_id;row.status='accepted';row.acceptedAt=stamp();
    }catch(e){row.status=e.uncertain?'unknown':'failed';row.error=e.status?e.message:'通知处理失败，请检查配置后重试。';}
    row.updatedAt=stamp();await save();return row;
  }
  let running=false;
  async function drain(){if(running)return;running=true;try{while(true){const row=[...db.notifications].reverse().find(n=>own(n)&&n.status==='pending');if(!row)break;await send(row);}}finally{running=false;}}
  const list=()=>db.notifications.filter(own).slice(0,200).map(({target,key,...row})=>row);
  async function retry(id,allowUnknown){const row=db.notifications.find(n=>own(n)&&n.id===id);if(!row)throw error('通知记录不存在',404);if(!['failed','unknown'].includes(row.status))throw error('只可重试失败或结果不确定的通知',409);if(Date.now()-Date.parse(row.updatedAt)<3500)throw error('请稍后再重试',429);await send(row,allowUnknown);return list().find(n=>n.id===id);}
  async function test(channel,ownerId){if(!['group','personal'].includes(channel))throw error('请选择通知渠道');if(channel==='personal'&&!db.members.some(m=>m.id===ownerId))throw error('请选择测试接收成员');if(db.notifications.some(n=>own(n)&&n.isTest&&Date.now()-Date.parse(n.createdAt)<10000))throw error('测试发送过于频繁，请10秒后重试',429);const row=append(channel,'',ownerId,'飞书连接测试','会议任务｜连接测试\n这是一条来自会议工作台的测试通知，不包含真实任务。',true);await save();await send(row);return list().find(n=>n.id===row.id);}
  return {config,configure,enqueue,enqueueTodo,drain,list,retry,test};
}
