import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApplication} from '../app/server.mjs';import {hashPassword} from '../app/auth.mjs';import {createOperations} from '../app/operations.mjs';import {createBackups} from '../app/records.mjs';
async function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-p0-'));const accounts=['admin','worker','reviewer','outsider'].map((username,i)=>({id:'a'+i,memberId:'m'+i,username,role:i?'member':'manager',passwordHash:hashPassword('Testing-12345')}));const db={version:1,accounts,members:accounts.map(a=>({id:a.memberId,name:a.username,department:'运营'})),stores:[{id:'store_a',name:'A店',region:'华东',ownerId:'m0'}],meetings:[],todos:[]};fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify(db));let external=0;const server=createApplication({dataDir:dir,fetchImpl:async()=>{external++;throw Error('No external notifications');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;const call=async(route,user='admin',method='GET',body)=>{const r=await fetch(base+route,{method,headers:{Cookie:cookies[user]||'','X-Requested-With':'MeetingLocal'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};const cookies={};for(const a of accounts)cookies[a.username]=(await call('/api/auth/login','','POST',{username:a.username,password:'Testing-12345'})).cookie;t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});return {call,base,cookies,dir,external:()=>external};}
test('P0 issue lifecycle: confirm, split, accept, handoff, review, close and reopen; draft never notifies',async t=>{
 const f=await fixture(t),{call}=f;const i=(await call('/api/workspace/issues','admin','POST',{title:'设备故障',storeId:'store_a',category:'设备'})).data.issue;
 assert.equal(i.status,'pending_confirmation');assert.equal((await call('/api/workspace/issues/'+i.id,'admin','PATCH',{action:'dispatch',requestId:'early',tasks:[]})).status,409);assert.equal(f.external(),0);
 await call('/api/workspace/issues/'+i.id,'admin','PATCH',{action:'confirm'});
 const payload={action:'dispatch',requestId:'dispatch-one',tasks:[{title:'采购部件',ownerId:'m1',reviewerId:'m2',collaboratorIds:['m0']},{title:'现场维修',ownerId:'m1',reviewerId:'m2'}]};
 const r=await call('/api/workspace/issues/'+i.id,'admin','PATCH',payload);assert.equal(r.status,200);assert.equal(r.data.tasks.length,2);const [one,two]=r.data.tasks;
 assert.equal((await call('/api/workspace/issues/'+i.id,'admin','PATCH',payload)).data.tasks.length,2);assert.equal((await call('/api/todos')).data.todos.length,2);
 assert.equal((await call('/api/todos/'+one.id,'worker','PATCH',{done:true})).status,409);
 assert.equal((await call('/api/todos/'+one.id,'worker','PATCH',{action:'progress',note:'尚未接单'})).status,409);
 assert.equal((await call('/api/workspace/tasks/'+one.id,'worker','POST',{action:'accept'})).status,200);
 assert.equal((await call('/api/workspace/tasks/'+one.id,'worker','POST',{action:'handoff',recipientId:'m0',note:'已采购，交接核对'})).status,200);
 const handoff=(await call('/api/todos')).data.todos.find(t=>t.id===one.id).handoffs[0];assert.equal((await call('/api/workspace/tasks/'+one.id,'admin','POST',{action:'acknowledge',handoffId:handoff.id,note:'已核对'})).status,200);
 await call('/api/workspace/tasks/'+one.id,'worker','POST',{action:'block',note:'等待配件'});assert.equal((await call('/api/todos/'+one.id,'worker','PATCH',{action:'progress',note:'配件仍在路上'})).data.todo.status,'blocked');assert.equal((await call('/api/todos/'+one.id,'worker','PATCH',{done:true})).status,409);await call('/api/workspace/tasks/'+one.id,'worker','POST',{action:'unblock',note:'配件到货'});
 await call('/api/todos/'+one.id,'worker','PATCH',{done:true});await call('/api/todos/'+one.id,'reviewer','PATCH',{action:'approve'});
 assert.equal((await call('/api/workspace/issues/'+i.id,'admin','PATCH',{action:'close'})).status,409);
 await call('/api/workspace/tasks/'+two.id,'worker','POST',{action:'return',note:'缺少设备编号'});assert.equal((await call('/api/workspace/tasks/'+two.id,'admin','POST',{action:'redispatch',note:'已补充',description:'设备A'})).status,200);await call('/api/workspace/tasks/'+two.id,'worker','POST',{action:'accept'});await call('/api/todos/'+two.id,'worker','PATCH',{done:true});await call('/api/todos/'+two.id,'reviewer','PATCH',{action:'approve'});
 assert.equal((await call('/api/workspace/issues/'+i.id,'reviewer','PATCH',{action:'close'})).data.issue.status,'closed');
 assert.equal((await call('/api/workspace/issues/'+i.id,'admin','PATCH',{action:'reopen',note:'故障复发'})).data.issue.status,'pending_assignment');
 assert.equal((await call('/api/workspace/issues/'+i.id,'outsider')).status,404);assert.equal(f.external(),0);
});
test('P0 meeting metadata, attachments, duplicate upload, confidential search, revision and decision history',async t=>{
 const {call,base,cookies}=await fixture(t);const route='/api/morning-meetings/upload?'+new URLSearchParams({fileName:'meeting.md',title:'会议',meetingDate:'2026-10-12',storeId:'store_a'});const upload=async()=>{const r=await fetch(base+route,{method:'POST',headers:{Cookie:cookies.admin,'X-Requested-With':'MeetingLocal'},body:'设备故障，需要维修。'});return r.json();};const m=(await upload()).meeting;assert.equal((await upload()).duplicate,true);
 const meta='/api/workspace/meetings/'+m.id;
 assert.equal((await call(meta+'/metadata','admin','PATCH',{meetingType:'门店例会',participantIds:['m0','m1'],hostId:'m0',sensitivity:'restricted',allowedMemberIds:['m0']})).status,200);
 assert.equal((await call(meta+'/metadata','worker')).status,404);
 const file=(await call(meta+'/files','admin','POST',{name:'资料.txt',base64:Buffer.from('证据').toString('base64')})).data.file;assert.ok(file.id);
 assert.equal((await fetch(base+meta+'/files/'+file.id,{headers:{Cookie:cookies.worker}})).status,404);
 assert.equal((await call('/api/workspace/query','worker','POST',{query:'设备'})).data.sources.length,0);
 const decision=(await call('/api/workspace/decisions','admin','POST',{meetingId:m.id,text:'安排维修',sourceExcerpt:'需要维修',status:'proposed'})).data.decision;
 const edited=(await call('/api/workspace/decisions','admin','POST',{id:decision.id,meetingId:m.id,text:'立即维修',sourceExcerpt:'需要维修',status:'confirmed',note:'负责人确认'})).data.decision;assert.equal(edited.history.length,2);
 await call('/api/morning-meetings/'+m.id+'/review','admin','PATCH',{transcript:'设备故障，需要维修。已补充型号。',summary:'设备问题',speakers:[],tasks:[]});const versions=(await call(meta+'/revisions')).data;assert.equal(versions.original,'设备故障，需要维修。');assert.equal(versions.revisions.length,1);
 assert.equal((await call('/api/admin/audit')).status,200);
 const backup=(await call('/api/admin/backups','admin','POST',{})).data.backup;assert.ok(backup.id);assert.equal((await call('/api/admin/backups','admin','POST',{action:'verify',id:backup.id})).data.valid,true);assert.equal((await call('/api/admin/backups','worker')).status,403);
});
test('P0 reminder dedup, escalation recipients and daily snapshots',async()=>{
 const db={members:[{id:'w',managerId:'boss'}],accounts:[],stores:[],meetings:[],todos:[{id:'todo_a',issueId:'issue_a',title:'维修',ownerId:'w',dispatchedBy:'boss',dueAt:'2026-10-10 12:00',done:false,status:'in_progress'}],businessRules:{remindersEnabled:true,escalationHours:1,escalationMemberIds:[]}};const events=[];const op=createOperations(db,async()=>{},{notify:(t,e)=>events.push(e)});await op.tick(new Date('2026-10-12T10:00:00+08:00'));await op.tick(new Date('2026-10-12T10:01:00+08:00'));assert.equal(events.length,1);assert.equal(events[0].action,'escalate');assert.deepEqual(events[0].recipientIds,['boss']);assert.equal(db.dailySnapshots.length,1);
});
test('P0 verified backup restores database and attachments and invalidates old sessions',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-backup-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.mkdirSync(path.join(dir,'uploads'));fs.writeFileSync(path.join(dir,'uploads','record.txt'),'original');const db={accounts:[{id:'a',version:2}],members:[],meetings:[],todos:[{id:'one'}]};const b=createBackups(db,async()=>{},dir);const snapshot=b.create();db.todos=[];fs.writeFileSync(path.join(dir,'uploads','record.txt'),'changed');const result=await b.restore(snapshot.id);assert.ok(result.safetyBackup);assert.equal(db.todos[0].id,'one');assert.equal(db.accounts[0].version,3);assert.equal(db.businessRules.remindersEnabled,false);assert.equal(db.mail.enabled,false);assert.ok(Array.isArray(db.issues));assert.equal(fs.readFileSync(path.join(dir,'uploads','record.txt'),'utf8'),'original');fs.writeFileSync(path.join(dir,'backups','complete',snapshot.id,'uploads','record.txt'),'tampered');assert.throws(()=>b.verify(snapshot.id),/校验失败/);
});
import {createMail} from '../app/mail.mjs';
import {notificationAllowed} from '../app/permissions.mjs';

test('Meeting and issue dispatch share tasks in both directions; reanalysis cannot duplicate sent tasks',async t=>{
 const f=await fixture(t),{call}=f;
 for(const first of ['issue','meeting']){
  const text='设备故障，需要维修。'+first;
  const r=await fetch(f.base+'/api/morning-meetings/upload?'+new URLSearchParams({fileName:first+'.md',title:first,meetingDate:'2026-10-12',storeId:'store_a'}),{method:'POST',headers:{Cookie:f.cookies.admin,'X-Requested-With':'MeetingLocal'},body:text});const m=(await r.json()).meeting;
  const saved=await call('/api/morning-meetings/'+m.id+'/review','admin','PATCH',{transcript:text,summary:'维修',speakers:[],tasks:[{title:'维修设备',assigneeId:'m1',sourceExcerpt:'设备故障，需要维修。',dueAt:'2026-12-01 10:00'}]});assert.equal(saved.status,200);
  if(first==='issue'){
   const i=(await call('/api/workspace/issues','admin','POST',{title:'维修设备',meetingId:m.id,excerpt:'设备故障，需要维修。',storeId:'store_a'})).data.issue;
   await call('/api/workspace/issues/'+i.id,'admin','PATCH',{action:'confirm'});
   assert.equal((await call('/api/workspace/issues/'+i.id,'admin','PATCH',{action:'dispatch',requestId:'first',tasks:[{title:'维修设备',ownerId:'m1',reviewerId:'m2'}]})).status,200);
   assert.equal((await call('/api/workspace/meetings/'+m.id+'/metadata','worker')).status,200);
   assert.equal((await call('/api/workspace/meetings/'+m.id+'/metadata','outsider')).status,404);
  }
  const published=await call('/api/morning-meetings/'+m.id+'/publish','admin','POST',{reviewerId:'m2'});assert.equal(published.status,200,JSON.stringify(published.data));
  const tasks=(await call('/api/todos')).data.todos.filter(x=>x.meetingId===m.id);assert.equal(tasks.length,1);assert.ok(tasks[0].issueId);assert.equal(tasks[0].reviewerId,'m2');
  await call('/api/morning-meetings/'+m.id+'/publish','admin','POST',{});assert.equal((await call('/api/todos')).data.todos.filter(x=>x.meetingId===m.id).length,1);
  assert.equal((await call('/api/morning-meetings/'+m.id+'/analyze','admin','POST',{})).status,409);
 }
 assert.equal(f.external(),0);
});

test('Meeting dispatch rolls back all groups when later evidence is invalid',()=>{
 const m={id:'meeting_a',uploadedBy:'admin',transcript:'设备坏了',speakers:[],tasks:[{id:'one',title:'修设备',assigneeId:'admin',sourceExcerpt:'设备坏了'},{id:'two',title:'错误证据',assigneeId:'admin',sourceExcerpt:'不存在'}]};
 const db={members:[{id:'admin'}],accounts:[],stores:[],meetings:[m],todos:[]};let notices=0;const op=createOperations(db,async()=>{},{notify:()=>notices++});
 assert.throws(()=>op.publishMeeting(m,{memberId:'admin',role:'manager'},'admin'),/证据/);assert.equal(db.todos.length,0);assert.equal(db.issues.length,0);assert.equal(m.tasks[0].todoId,undefined);assert.equal(notices,0);
});
test('P0 email dedup, credentials masking and confidential notification enforcement',async()=>{
 let sent=0;const db={members:[{id:'w',email:'worker@example.com'}],todos:[{id:'todo_a',ownerId:'w',sensitivity:'restricted',allowedMemberIds:[]}],meetings:[],issues:[],accounts:[],mail:{enabled:true,host:'smtp.example.com',port:465,secure:true,user:'u',password:'secret',from:'sender@example.com'}};const mail=createMail(db,async()=>{},{transportFactory:()=>({sendMail:async()=>{sent++;},verify:async()=>true})});const task=db.todos[0],event={id:'event1',action:'dispatch',recipientIds:['w']};mail.enqueue(task,event);mail.enqueue(task,event);assert.equal(db.serviceEvents.length,1);await mail.drain();assert.equal(sent,0);assert.equal(db.serviceEvents[0].status,'failed');task.allowedMemberIds=['w'];await mail.retry({id:db.serviceEvents[0].id});assert.equal(sent,1);assert.equal(mail.config().password,undefined);assert.equal(notificationAllowed(db,{todoId:task.id,channel:'group'}),false);assert.equal(notificationAllowed(db,{todoId:task.id,channel:'personal',ownerId:'w'}),true);
});
test('P0 configurable permissions and handover keep history while revoking leaver access',async t=>{
 const {call}=await fixture(t);
 const task=(await call('/api/todos','admin','POST',{title:'交接任务',ownerId:'m1',reviewerId:'m1'})).data.todo;
 assert.equal((await call('/api/admin/handover','worker','POST',{from:'m1',to:'m2',note:'离职',depart:true})).status,403);
 const r=await call('/api/admin/handover','admin','POST',{from:'m1',to:'m2',note:'离职交接',depart:true});assert.equal(r.data.count,1);
 assert.equal((await call('/api/todos','worker')).status,401);const transferred=(await call('/api/todos')).data.todos.find(t=>t.id===task.id);assert.equal(transferred.ownerId,'m2');assert.equal(transferred.reviewerId,'m2');assert.ok(transferred.timeline.some(e=>e.previousOwnerId==='m1'));
 const org=(await call('/api/admin/organization','admin','POST',{name:'总部',type:'headquarters'})).data.row;
 assert.equal((await call('/api/admin/organization','admin','POST',{id:org.id,name:'总部',parentId:org.id})).status,400);
});

test('Chain organization: regions, store moves, automatic member region and permission preservation',async t=>{
 const {call}=await fixture(t);
 const directory=(await call('/api/admin/organization')).data;const east=directory.organizations.find(o=>o.type==='region'&&o.name==='华东');assert.ok(east);
 assert.equal((await call('/api/admin/chain','worker','POST',{kind:'region',name:'越权'})).status,403);
 const west=(await call('/api/admin/chain','admin','POST',{kind:'region',name:'华西',managerId:'m0'})).data.region;assert.ok(west.id);
 const shop=(await call('/api/admin/chain','admin','POST',{kind:'store',name:'新店',region:'华东',ownerId:'',status:'preparing'})).data.store;assert.equal(shop.status,'preparing');
 await call('/api/members/m1','admin','PATCH',{storeId:shop.id});
 assert.equal((await call('/api/members')).data.members.find(m=>m.id==='m1').region,'华东');
 await call('/api/accounts/m1','admin','PUT',{username:'worker',role:'region',regions:['华东'],disabled:false});
 await call('/api/admin/chain','admin','POST',{kind:'region',id:east.id,name:'东部大区',managerId:'m0'});
 assert.deepEqual((await call('/api/accounts')).data.accounts.find(a=>a.memberId==='m1').regions,['东部大区']);
 assert.equal((await call('/api/stores')).data.stores.find(s=>s.id===shop.id).region,'东部大区');
 assert.equal((await call('/api/members')).data.members.find(m=>m.id==='m1').region,'东部大区');
 await call('/api/admin/chain','admin','POST',{kind:'store',id:shop.id,name:'新店',region:'华西',ownerId:'m0',status:'open'});
 assert.equal((await call('/api/members')).data.members.find(m=>m.id==='m1').region,'华西');
 await call('/api/members/m1','admin','PATCH',{storeId:'',region:'',unitType:'headquarters',department:'运营'});
 const member=(await call('/api/members')).data.members.find(m=>m.id==='m1');assert.equal(member.unitType,'headquarters');assert.equal(member.region,'');
 assert.equal((await call('/api/admin/chain','admin','POST',{kind:'region',name:'华西'})).status,400);
});
