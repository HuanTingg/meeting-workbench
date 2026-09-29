import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createDingTalk} from '../app/dingtalk.mjs';
async function setup(fetchImpl){const db={members:[{id:'a',name:'甲',dingtalkUserId:'user-a'},{id:'b',name:'乙',dingtalkUserId:'user-b'}],todos:[{id:'1',title:'甲的任务',ownerId:'a',meetingId:'m',dueAt:'2026-10-01',priority:'high'},{id:'2',title:'乙的任务',ownerId:'b',meetingId:'m',dueAt:'',priority:'normal'}]};const ding=createDingTalk(db,()=>{},fetchImpl);await ding.configure({groupEnabled:true,personalEnabled:true,webhook:'https://oapi.dingtalk.com/robot/send?access_token=secret',signSecret:'SEC-sign',appKey:'app',appSecret:'private',agentId:'123'});return {db,ding};}
test('group signed notification and personal content isolation with durable dedup',async()=>{
  const calls=[];const {db,ding}=await setup(async(url,options)=>{const u=new URL(url);const b=options.body&&JSON.parse(options.body);calls.push({u,b});if(u.pathname==='/gettoken')return Response.json({errcode:0,access_token:'token'});if(u.pathname==='/robot/send'){assert.equal(u.searchParams.get('sign'),createHmac('sha256','SEC-sign').update(u.searchParams.get('timestamp')+'\nSEC-sign').digest('base64'));return Response.json({errcode:0});}return Response.json({errcode:0,task_id:999});});
  ding.enqueue({id:'m',title:'周会',meetingDate:'2026-09-28'});ding.enqueue({id:'m',title:'周会',meetingDate:'2026-09-28'});assert.equal(db.notifications.length,3);
  await ding.drain();assert.equal(db.notifications.filter(n=>n.status==='accepted').length,3);
  const personal=calls.filter(c=>c.b?.userid_list);assert.equal(personal.length,2);assert.equal(personal[0].b.to_all_user,false);
  for(const {b} of personal){assert.ok(b.msg.text.content.includes(b.userid_list==='user-a'?'甲的任务':'乙的任务'));assert.ok(!b.msg.text.content.includes(b.userid_list==='user-a'?'乙的任务':'甲的任务'));}
  assert.ok(!JSON.stringify(ding.config()).includes('private'));assert.ok(!JSON.stringify(ding.config()).includes('SEC-sign'));assert.ok(!JSON.stringify(ding.list()).includes('access_token'));
});
test('unknown send outcome requires explicit retry and restart does not resubmit',async()=>{
  const {db,ding}=await setup(async()=>{throw Error('private token');});ding.enqueue({id:'m',title:'周会',meetingDate:'2026-09-28'});
  const group=db.notifications.find(n=>n.channel==='group');group.status='sending';
  const resumed=createDingTalk(db,()=>{},async()=>{throw Error('should not send');});assert.equal(group.status,'unknown');group.updatedAt='2020-01-01T00:00:00Z';
  await assert.rejects(()=>resumed.retry(group.id,false),/不确定/);assert.equal(group.attempts,0);
});
test('mapping and configuration errors are safe and failed sends do not claim delivery',async()=>{
  const {db,ding}=await setup(async()=>Response.json({errcode:40014,errmsg:'private-token'}));db.members[0].dingtalkUserId='';
  const result=await ding.test('personal','a');assert.equal(result.status,'failed');assert.match(result.error,/userid/);
  db.notifications=[];const group=await ding.test('group','');assert.equal(group.status,'failed');assert.ok(!group.error.includes('private-token'));
  await assert.rejects(()=>ding.configure({groupEnabled:true,webhook:'https://evil.example/robot/send?access_token=secret'}));
  const c=await ding.configure({appKey:'another',groupEnabled:false,personalEnabled:false});assert.equal(c.hasAppSecret,false);
});
