import {hashPassword} from '../app/auth.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApplication} from '../app/server.mjs';

async function fixture(t,fetchImpl) {
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-local-test-'));
  fs.writeFileSync(path.join(dataDir,'workspace.json'),JSON.stringify({version:1,members:[],meetings:[],todos:[],accounts:[{id:'account_test',memberId:'test-admin',username:'admin',passwordHash:hashPassword('Test-password-123'),role:'manager'}]}));
  const server=createApplication({dataDir,fetchImpl});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dataDir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'X-Requested-With':'MeetingLocal','Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'Test-password-123'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  async function req(url,method='GET',body,headers={}) {
    const response=await fetch(base+url,{method,headers:{Cookie:cookie,'X-Requested-With':'MeetingLocal',...(body && !Buffer.isBuffer(body)?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  }
  const upload=async(body=Buffer.from('林雨：明天提交需求说明。'),name='notes.md')=>(await req('/api/morning-meetings/upload?'+new URLSearchParams({title:'会议验收',meetingDate:'2026-09-28',fileName:name}),'POST',body,{'Content-Type':name.endsWith('.md')?'text/markdown':'audio/wav'})).data.meeting;
  return {server,req,base,upload,dataDir,cookie};
}
test('Feishu configuration and member bindings preserve DingTalk fields and persist',async t=>{
  const {req,dataDir}=await fixture(t,async()=>{throw Error('No external requests');});
  assert.equal((await req('/api/feishu/config')).data.groupEnabled,false);
  assert.equal((await req('/api/feishu/config','PUT',{appId:'cli_test',appSecret:'secret'})).data.hasAppSecret,true);
  const member=(await req('/api/members','POST',{name:'绑定测试'})).data.member;
  await req('/api/members/'+member.id,'PATCH',{dingtalkUserId:'ding-123'});
  assert.equal((await req('/api/members/'+member.id,'PATCH',{feishuOpenId:'ou_test',feishuAppId:'cli_test'})).data.member.dingtalkUserId,'ding-123');
  assert.equal((await req('/api/members/'+member.id,'PATCH',{dingtalkUserId:'ding-456'})).data.member.feishuOpenId,'ou_test');
  assert.equal((await req('/api/members/'+member.id,'PATCH',{feishuOpenId:'ou_bad',feishuAppId:'cli_other'})).status,400);
  const disk=JSON.parse(fs.readFileSync(path.join(dataDir,'workspace.json'),'utf8'));assert.equal(disk.feishu.appId,'cli_test');assert.equal(disk.members[0].feishuAppId,'cli_test');
  assert.equal((await req('/api/feishu/config')).data.appSecret,undefined);
});

test('manager workflow: upload, draft, publish once, complete and persist',async t=>{
  const {req,upload,dataDir}=await fixture(t);
  assert.equal((await req('/api/health')).status,200);
  const member=(await req('/api/members','POST',{name:'林雨',department:'产品'})).data.member;
  const m=await upload();
  const analyzed=await req(`/api/morning-meetings/${m.id}/analyze`,'POST',{});
  assert.equal(analyzed.data.analysisMode,'transcription-only');
  const draft={transcript:m.transcript,summary:'需求评审',speakers:[],tasks:[{title:'提交需求说明',assigneeId:member.id,sourceExcerpt:'明天提交需求说明',dueAt:'2026-09-29 10:00',priority:'high'}]};
  assert.equal((await req(`/api/morning-meetings/${m.id}/review`,'PATCH',draft)).status,200);
  assert.equal((await req(`/api/morning-meetings/${m.id}/publish`,'POST',{})).data.publishedCount,1);
  await req(`/api/morning-meetings/${m.id}/publish`,'POST',{});
  const todos=(await req('/api/todos')).data.todos;assert.equal(todos.length,1);
  assert.equal(todos[0].ownerId,member.id);
  await req('/api/todos/'+todos[0].id,'PATCH',{done:true});
  const disk=JSON.parse(fs.readFileSync(path.join(dataDir,'workspace.json'),'utf8'));assert.equal(disk.todos[0].done,true);
  assert.equal((await req(`/api/morning-meetings/${m.id}/analyze`,'POST',{})).status,409);
  assert.equal((await req('/api/members/'+member.id,'DELETE')).status,400);
});
test('review validation rejects unknown people, fabricated evidence, dates and skipped speakers',async t=>{
  const {req,upload}=await fixture(t);
  const member=(await req('/api/members','POST',{name:'林雨'})).data.member,m=await upload();
  const base={transcript:m.transcript,summary:'',speakers:[],tasks:[{title:'提交',assigneeId:member.id,sourceExcerpt:'明天提交需求说明',dueAt:''}]};
  for(const change of [{assigneeId:'unknown'},{sourceExcerpt:'凭空编造'},{dueAt:'2026-02-30'}]){
    assert.equal((await req(`/api/morning-meetings/${m.id}/review`,'PATCH',{...base,tasks:[{...base.tasks[0],...change}]})).status,400);
  }
  await req(`/api/morning-meetings/${m.id}/review`,'PATCH',{...base,speakers:[{label:'林雨',assigneeId:member.id,ignored:true}],tasks:[{...base.tasks[0],speakerLabel:'林雨'}]});
  assert.equal((await req(`/api/morning-meetings/${m.id}/publish`,'POST',{})).status,400);
  assert.equal((await req('/api/todos')).data.todos.length,0);
});
test('AI config masks secrets, tests without saving and never reuses a key at a different host',async t=>{
  let called=0;
  const {req}=await fixture(t,async(url,options)=>{called++;assert.equal(options.headers.Authorization,'Bearer private-key');return Response.json({choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]});});
  const c={aiEnabled:true,baseUrl:'https://model.example/v1',model:'test',apiKey:'private-key',transcriptionUrl:''};
  assert.equal((await req('/api/settings/test','POST',c)).status,200);assert.equal(called,1);
  assert.equal((await req('/api/settings')).data.aiEnabled,false);
  const saved=await req('/api/settings','PUT',c);assert.equal(saved.data.hasKey,true);assert.ok(!JSON.stringify(saved).includes('private-key'));
  assert.equal((await req('/api/settings','PUT',{...c,apiKey:''})).data.hasKey,true);
  assert.equal((await req('/api/settings','PUT',{...c,baseUrl:'https://other.example/v1',apiKey:''})).data.hasKey,false);
  assert.equal((await req('/api/settings','PUT',{...c,baseUrl:'file:///tmp'})).status,400);
});
test('audio transcription survives AI failure; retry reuses text and protects concurrent jobs',async t=>{
  let audioCalls=0,aiWorks=false,owner='',release;
  const {req,upload,base,cookie}=await fixture(t,async(url,options)=>{
    if(url.endsWith('/audio/transcriptions')){audioCalls++;await new Promise(r=>release=r);return Response.json({text:'林雨负责提交需求说明。',segments:[{speaker:'1',start:0,end:2,text:'林雨负责提交需求说明。'}]});}
    if(!aiWorks)return new Response('private upstream error',{status:500});
    assert.equal(JSON.parse(options.body).response_format.type,'json_object');
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'需求会议',speakers:[],tasks:[{title:'提交需求说明',assigneeId:owner,sourceExcerpt:'林雨负责提交需求说明。'}]})}}]});
  });
  owner=(await req('/api/members','POST',{name:'林雨'})).data.member.id;
  await req('/api/settings','PUT',{aiEnabled:true,baseUrl:'https://model.example/v1',model:'test',transcriptionUrl:'http://127.0.0.1:10096/v1'});
  const m=await upload(Buffer.from('fake audio fixture'),'voice.wav');
  const pending=req(`/api/morning-meetings/${m.id}/analyze`,'POST',{});
  while(!release)await new Promise(r=>setTimeout(r,5));
  assert.equal((await req(`/api/morning-meetings/${m.id}/analyze`,'POST',{})).status,409);
  release();const failed=await pending;assert.equal(failed.status,502);assert.ok(!JSON.stringify(failed).includes('private upstream'));
  const preserved=(await req('/api/morning-meetings/'+m.id)).data.meeting;assert.equal(preserved.transcript,'林雨负责提交需求说明。');assert.equal(preserved.transcriptSegments.length,1);
  aiWorks=true;assert.equal((await req(`/api/morning-meetings/${m.id}/analyze`,'POST',{})).data.analysisMode,'ai');assert.equal(audioCalls,1);
  const audio=await fetch(`${base}/api/morning-meetings/${m.id}/audio`,{headers:{Range:'bytes=0-3',Cookie:cookie}});assert.equal(audio.status,206);assert.equal(await audio.text(),'fake');
});
test('untrusted browser writes blocked, static paths do not expose files, deletion removes source',async t=>{
  const {req,base,upload,dataDir}=await fixture(t);
  assert.equal((await fetch(base+'/api/members',{method:'POST',body:'{}'})).status,403);
  assert.equal((await req('/api/members','POST',{name:'bad'},{Origin:'https://external.example'})).status,403);
  assert.equal((await fetch(base+'/data/workspace.json')).status,404);
  const m=await upload();assert.ok(fs.existsSync(path.join(dataDir,'uploads',m.audioFileName)));
  assert.equal((await req('/api/morning-meetings/'+m.id,'DELETE')).status,200);
  assert.equal(fs.existsSync(path.join(dataDir,'uploads',m.audioFileName)),false);
});
test('restart turns interrupted analysis into a retryable failure',async t=>{
  const {dataDir,upload}=await fixture(t);const m=await upload();
  const file=path.join(dataDir,'workspace.json'),db=JSON.parse(fs.readFileSync(file,'utf8'));db.meetings[0].status='processing';fs.writeFileSync(file,JSON.stringify(db));
  const restarted=createApplication({dataDir});assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).meetings[0].status,'failed');restarted.close();
});

test('manager creates manual todo and queues DingTalk and Feishu notices',async t=>{
  const {req,dataDir}=await fixture(t,async url=>{if(String(url).includes('/auth/'))return Response.json({code:0,tenant_access_token:'token'});if(String(url).includes('/messages?'))return Response.json({code:0,data:{message_id:'om_test'}});return Response.json({errcode:0});});
  const member=(await req('/api/members','POST',{name:'接收人'})).data.member;
  await req('/api/dingtalk/config','PUT',{groupEnabled:true,webhook:'https://oapi.dingtalk.com/robot/send?access_token=test'});
  await req('/api/feishu/config','PUT',{groupEnabled:true,appId:'cli_test',appSecret:'test',chatId:'oc_test'});
  const result=await req('/api/todos','POST',{title:'手动同步验证',ownerId:member.id,description:'完成要求'});assert.equal(result.status,201);
  const disk=JSON.parse(fs.readFileSync(path.join(dataDir,'workspace.json'),'utf8'));assert.equal(disk.notifications.length,2);assert.ok(disk.notifications.every(n=>n.todoId===result.data.todo.id));assert.equal(disk.notifications.filter(n=>n.provider==='feishu').length,1);
});
