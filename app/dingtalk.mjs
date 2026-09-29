import {createHmac, randomUUID, createHash} from 'node:crypto';
const clean=(v,n=200)=>typeof v==='string'?v.trim().slice(0,n):'';
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const stamp=()=>new Date().toISOString();
const digest=v=>createHash('sha256').update(v).digest('hex');
export function createDingTalk(db,save,fetchImpl) {
  db.dingtalk={groupEnabled:false,personalEnabled:false,groupName:'会议通知群',webhook:'',signSecret:'',keyword:'会议任务',appKey:'',appSecret:'',agentId:'',...db.dingtalk};
  db.notifications??=[];
  const own=n=>!n.provider||n.provider==='dingtalk';
  for(const row of db.notifications.filter(own))if(row.status==='sending'){row.status='unknown';row.error='发送被中断，可能已到达钉钉；请核实后决定是否重发。';}
  const config=()=>{const {webhook,signSecret,appSecret,...rest}=db.dingtalk;return {...rest,hasWebhook:!!webhook,hasSignSecret:!!signSecret,hasAppSecret:!!appSecret};};
  async function configure(b) {
    const old=db.dingtalk;
    const c={groupEnabled:b.groupEnabled===true,personalEnabled:b.personalEnabled===true,groupName:clean(b.groupName)||'会议通知群',keyword:clean(b.keyword,40)||'会议任务',appKey:clean(b.appKey),agentId:clean(b.agentId,30)};
    c.webhook=b.clearWebhook?'':clean(b.webhook,2000)||old.webhook;
    if(c.webhook){let u;try{u=new URL(c.webhook);}catch{throw error('群机器人 Webhook 格式无效');}if(u.origin!=='https://oapi.dingtalk.com'||u.pathname!=='/robot/send'||!u.searchParams.get('access_token')||u.username||u.password||u.hash)throw error('请填写钉钉官方群机器人 Webhook');c.webhook='https://oapi.dingtalk.com/robot/send?'+new URLSearchParams({access_token:u.searchParams.get('access_token')});}
    c.signSecret=b.clearSignSecret?'':clean(b.signSecret,500)||(c.webhook===old.webhook?old.signSecret:'');
    c.appSecret=b.clearAppSecret?'':clean(b.appSecret,1000)||(c.appKey===old.appKey?old.appSecret:'');
    if(c.groupEnabled&&!c.webhook)throw error('启用群通知需要群机器人 Webhook');
    if(c.personalEnabled&&(!c.appKey||!c.appSecret||!/^\d+$/.test(c.agentId)||!Number.isSafeInteger(Number(c.agentId))))throw error('启用个人工作通知需要 AppKey、AppSecret 和有效的 AgentId');
    if(db.notifications.some(n=>own(n)&&n.status==='sending'))throw error('正在发送通知，请稍后修改配置',409);
    db.dingtalk=c;await save();return config();
  }
  function append(channel,meetingId,ownerId,title,content,isTest=false) {
    const key=isTest?randomUUID():`${meetingId}:${channel}:${ownerId||'group'}`;
    const prior=db.notifications.find(n=>own(n)&&n.key===key);if(prior)return prior;
    const row={id:'notice_'+randomUUID().replaceAll('-',''),key,channel,meetingId,ownerId,title,content,isTest,status:'pending',attempts:0,createdAt:stamp(),error:''};db.notifications.unshift(row);return row;
  }
  function enqueue(m) {
    const c=db.dingtalk, tasks=db.todos.filter(t=>t.meetingId===m.id);
    const headline=`${c.keyword}｜${m.title}`;
    // Keep complete task titles and dates; reject over-limit messages explicitly.
    const body=list=>`${headline}\n会议日期：${m.meetingDate}\n\n`+list.map((t,i)=>`${i+1}. ${t.title}\n负责人：${db.members.find(p=>p.id===t.ownerId)?.name||'未指定'}\n截止：${t.dueAt||'未指定'}\n优先级：${({high:'高',medium:'中',normal:'普通'})[t.priority]||'普通'}`).join('\n\n');
    if(c.groupEnabled)append('group',m.id,'',headline,body(tasks));
    if(c.personalEnabled)for(const ownerId of new Set(tasks.map(t=>t.ownerId)))append('personal',m.id,ownerId,headline,body(tasks.filter(t=>t.ownerId===ownerId)));
  }
  function enqueueTodo(t) {
    const c=db.dingtalk,headline=`${c.keyword}｜新增待办`;
    const content=`${headline}\n任务：${t.title}\n负责人：${db.members.find(m=>m.id===t.ownerId)?.name||'未指定'}\n截止：${t.dueAt||'未指定'}\n优先级：${({high:'高',medium:'中',normal:'普通'})[t.priority]||'普通'}${t.description?'\n执行说明：'+t.description:''}`;
    for(const channel of ['group','personal'])if(c[channel+'Enabled']){const row=append(channel,'manual:'+t.id,channel==='personal'?t.ownerId:'',headline,content);row.todoId=t.id;row.meetingId='';}
  }
  async function request(url,body,send=false) {
    let r;try{r=await fetchImpl(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw Object.assign(error(send?'网络超时或连接中断，发送结果不确定，请核实后再重试。':'获取钉钉令牌失败，请检查网络。',502),{uncertain:send});}
    if(!r.ok)throw Object.assign(error(`钉钉接口 HTTP ${r.status}，请检查配置与服务状态。`,502),{uncertain:send&&r.status>=500});
    let data;try{data=await r.json();}catch{throw Object.assign(error('钉钉响应无法解析。',502),{uncertain:send});}
    if(data.errcode!==0)throw error(`钉钉拒绝请求（错误码 ${Number.isFinite(Number(data.errcode))?Number(data.errcode):'未知'}），请检查权限、应用可见范围、userid及机器人安全设置。`,502);
    return data;
  }
  async function send(row,allowUnknown=false) {
    if(['accepted','sending'].includes(row.status))return row;
    if(row.status==='unknown'&&!allowUnknown)throw error('发送结果不确定；确认钉钉中未收到后，才能重发。',409);
    const c={...db.dingtalk};
    row.status='sending';row.attempts++;row.updatedAt=stamp();row.error='';await save();
    try {
      if(Buffer.byteLength(row.content,'utf8')>1800)throw error('通知内容超过长度限制，请拆分会议任务后发送。');
      if(row.channel==='group') {
        if(!c.groupEnabled||!c.webhook)throw error('群通知未启用或未配置');
        const target=digest(c.webhook);
        if(row.target&&row.target!==target)throw error('群目标已改变，为避免发错群，此记录不能重试。');
        row.target=target;row.recipient=c.groupName;await save();
        const url=new URL(c.webhook);
        if(c.signSecret){const timestamp=String(Date.now());url.searchParams.set('timestamp',timestamp);url.searchParams.set('sign',createHmac('sha256',c.signSecret).update(timestamp+'\n'+c.signSecret).digest('base64'));}
        await request(url.href,{msgtype:'text',text:{content:row.content},at:{isAtAll:false}},true);
      }else{
        if(!c.personalEnabled)throw error('个人通知未启用');
        const member=db.members.find(m=>m.id===row.ownerId), userid=member?.dingtalkUserId;
        if(!userid)throw error('负责人未填写钉钉 userid，请在成员页面补充后重试。');
        const target=digest(c.appKey+'|'+c.agentId+'|'+userid);
        if(row.target&&row.target!==target)throw error('应用或接收人已改变，为避免发错人，此记录不能重试。');
        row.target=target;row.recipient=member.name;await save();
        const token=await request('https://oapi.dingtalk.com/gettoken?'+new URLSearchParams({appkey:c.appKey,appsecret:c.appSecret}));
        if(!token.access_token)throw error('钉钉未返回有效令牌',502);
        const result=await request('https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2?'+new URLSearchParams({access_token:token.access_token}),{agent_id:Number(c.agentId),userid_list:userid,to_all_user:false,msg:{msgtype:'text',text:{content:row.content}}},true);
        row.remoteTaskId=String(result.task_id??'');
        if(!row.remoteTaskId)throw Object.assign(error('钉钉未返回发送任务编号，结果待核实。',502),{uncertain:true});
      }
      row.status='accepted';row.acceptedAt=stamp();
    }catch(e){row.status=e.uncertain?'unknown':'failed';row.error=e.status?e.message:'通知处理失败，请检查配置后重试。';}
    row.updatedAt=stamp();await save();return row;
  }
  let running=false;
  async function drain(){if(running)return;running=true;try{while(true){const row=[...db.notifications].reverse().find(n=>own(n)&&n.status==='pending');if(!row)break;await send(row);await new Promise(r=>setTimeout(r,3200));}}finally{running=false;}}
  const list=()=>db.notifications.filter(own).slice(0,200).map(({target,key,...row})=>row);
  async function retry(id,allowUnknown){const row=db.notifications.find(n=>own(n)&&n.id===id);if(!row)throw error('通知记录不存在',404);if(!['failed','unknown'].includes(row.status))throw error('只可重试失败或结果不确定的通知',409);if(Date.now()-Date.parse(row.updatedAt)<3500)throw error('请稍后再重试',429);await send(row,allowUnknown);return list().find(n=>n.id===id);}
  async function test(channel,ownerId){if(!['group','personal'].includes(channel))throw error('请选择通知渠道');if(channel==='personal'&&!db.members.some(m=>m.id===ownerId))throw error('请选择测试接收成员');if(db.notifications.some(n=>own(n)&&n.isTest&&Date.now()-Date.parse(n.createdAt)<10000))throw error('测试发送过于频繁，请10秒后重试',429);const row=append(channel,'',ownerId, '钉钉连接测试',`${db.dingtalk.keyword}｜连接测试\n这是一条来自会议工作台的测试通知，不包含真实任务。`,true);await save();await send(row);return list().find(n=>n.id===row.id);}
  return {config,configure,enqueue,enqueueTodo,drain,list,retry,test};
}
