import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createFeishu} from '../app/feishu.mjs';
import {createDingTalk} from '../app/dingtalk.mjs';
async function setup(fetchImpl){
  const db={members:[{id:'a',name:'甲',feishuOpenId:'ou_a',feishuAppId:'cli_test'},{id:'b',name:'乙',feishuOpenId:'ou_b',feishuAppId:'cli_test'}],todos:[{title:'甲的任务',ownerId:'a',meetingId:'m'},{title:'乙的任务',ownerId:'b',meetingId:'m'}]};
  const feishu=createFeishu(db,()=>{},fetchImpl);
  await feishu.configure({appId:'cli_test',appSecret:'private-secret',chatId:'oc_test',groupEnabled:true,personalEnabled:true});
  return {db,feishu};
}
test('Feishu group/personal recipients, isolated content, durable dedup and DingTalk separation',async()=>{
  const calls=[];const {db,feishu}=await setup(async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body,headers:options.headers});if(url.includes('/auth/'))return Response.json({code:0,tenant_access_token:'private-token'});return Response.json({code:0,data:{message_id:'om_test'}});});
  feishu.enqueue({id:'m',title:'周会',meetingDate:'2026-09-28'});feishu.enqueue({id:'m',title:'周会',meetingDate:'2026-09-28'});
  assert.equal(db.notifications.length,3);
  const ding=createDingTalk(db,()=>{},()=>{throw Error('Feishu must not use DingTalk');});
  await ding.drain();assert.equal(ding.list().length,0);
  db.notifications.push({id:'ding',channel:'group',status:'pending'});
  await feishu.drain();assert.equal(feishu.list().length,3);assert.equal(db.notifications.find(n=>n.id==='ding').status,'pending');
  assert.ok(feishu.list().every(n=>n.status==='accepted'));
  const sent=calls.filter(c=>c.url.includes('/messages?'));assert.equal(sent.length,3);
  assert.ok(sent.find(c=>c.body.receive_id==='oc_test').url.endsWith('receive_id_type=chat_id'));
  for(const owner of ['a','b']){const c=sent.find(c=>c.body.receive_id==='ou_'+owner);assert.ok(c.url.endsWith('receive_id_type=open_id'));assert.equal(c.headers.Authorization,'Bearer private-token');const text=JSON.parse(c.body.content).text;assert.ok(text.includes(owner==='a'?'甲的任务':'乙的任务'));assert.ok(!text.includes(owner==='a'?'乙的任务':'甲的任务'));assert.match(c.body.uuid,/^[a-f0-9]{32}$/);}
  assert.ok(!JSON.stringify(feishu.config()).includes('private-secret'));
});
test('Feishu rejects stale member mapping, preserves/clears secret on config changes',async()=>{
  let calls=0;const {db,feishu}=await setup(async()=>{calls++;throw Error('must not send');});
  db.members[0].feishuAppId='cli_old';const r=await feishu.test('personal','a');assert.equal(r.status,'failed');assert.match(r.error,/其他应用/);assert.equal(calls,0);
  const saved=await feishu.configure({appId:'cli_test'});assert.equal(saved.hasAppSecret,true);
  await assert.rejects(feishu.configure({appId:'cli_next',personalEnabled:true}),/App Secret/);
  const changed=await feishu.configure({appId:'cli_next'});assert.equal(changed.hasAppSecret,false);
});
test('Feishu uncertain send cannot be retried silently or routed to changed recipient',async()=>{
  const {db,feishu}=await setup(async url=>{if(url.includes('/auth/'))return Response.json({code:0,tenant_access_token:'token'});throw Error('private token');});
  const r=await feishu.test('group','');assert.equal(r.status,'unknown');assert.ok(!r.error.includes('private token'));
  const row=db.notifications[0];row.updatedAt='2020-01-01';await assert.rejects(feishu.retry(row.id,false),/不确定/);
  row.status='sending';const resumed=createFeishu(db,()=>{},()=>{throw Error('No resend');});assert.equal(row.status,'unknown');await resumed.drain();
  await resumed.configure({appId:'cli_test',chatId:'oc_other',groupEnabled:true});
  const result=await resumed.retry(row.id,true);assert.equal(result.status,'failed');assert.match(result.error,/目标已改变/);
});
test('HTTP 400 preserves Feishu code and required scopes without exposing response secrets',async()=>{
  const {feishu}=await setup(async url=>url.includes('/auth/')?Response.json({code:0,tenant_access_token:'private-token'}):Response.json({code:99991672,msg:'Access denied. One of the following scopes is required: [im:message:send_as_bot]. secret=private-secret token=private-token'},{status:400}));
  const result=await feishu.test('group','');
  assert.equal(result.status,'failed');assert.match(result.error,/发送消息.*HTTP 400.*99991672/);assert.match(result.error,/im:message:send_as_bot/);assert.ok(!result.error.includes('private-'));
});
test('HTTP 400 at auth stage is distinguished from sending and no message is sent',async()=>{
  let calls=0;const {feishu}=await setup(async()=>{calls++;return Response.json({code:10014,msg:'invalid app secret private-secret'},{status:400});});
  const result=await feishu.test('group','');assert.equal(calls,1);assert.equal(result.status,'failed');assert.match(result.error,/获取应用令牌.*10014/);assert.ok(!result.error.includes('private-secret'));
});
