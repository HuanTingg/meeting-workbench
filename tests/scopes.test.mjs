import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApplication} from '../app/server.mjs';import {hashPassword} from '../app/auth.mjs';
test('role scopes protect tasks, meetings, audio, attachments and administrative endpoints',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-scopes-'));
 const accounts=[['admin','manager'],['hq','head'],['east','region'],['shop','store'],['staff','member']].map(([username,role],i)=>({id:'a'+i,memberId:'m'+i,username,role,regions:role==='region'?['华东']:[],storeIds:role==='store'?['store_a']:[],passwordHash:hashPassword('Password-123')}));
 const stores=[{id:'store_a',name:'A店',region:'华东',ownerId:'m3'},{id:'store_b',name:'B店',region:'华西',ownerId:'m0'}];
 const meetings=['a','b'].map(k=>({id:'meeting_'+k,storeId:'store_'+k,uploadedBy:'m0',status:'review',transcript:'会议原文',tasks:[],speakers:[]}));
 const todos=['a','b'].map(k=>({id:'todo_'+k,storeId:'store_'+k,meetingId:'meeting_'+k,ownerId:'m4',reviewerId:'m0',dispatchedBy:'m0',title:k,done:false}));
 fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify({members:accounts.map(a=>({id:a.memberId,name:a.username})),accounts,stores,meetings,todos}));
 const server=createApplication({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(route,cookie,method='GET',body)=>{const r=await fetch(base+route,{method,headers:{Cookie:cookie||'','X-Requested-With':'MeetingLocal'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
 const cookies={};for(const a of accounts)cookies[a.username]=(await call('/api/auth/login','','POST',{username:a.username,password:'Password-123'})).cookie;
 for(const name of ['east','shop']){
  const c=cookies[name];assert.deepEqual((await call('/api/todos',c)).data.todos.map(t=>t.id),['todo_a']);assert.deepEqual((await call('/api/morning-meetings',c)).data.meetings.map(t=>t.id),['meeting_a']);assert.equal((await call('/api/stores',c)).data.stores.length,1);
  for(const route of ['/api/morning-meetings/meeting_b','/api/morning-meetings/meeting_b/audio','/api/todos/todo_b/attachments/proof_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'])assert.equal((await call(route,c)).status,404);
  assert.equal((await call('/api/todos/todo_b',c,'PATCH',{action:'progress',note:'越权'})).status,404);
  assert.equal((await call('/api/todos',c,'POST',{title:'跨范围自建',ownerId:name==='east'?'m2':'m3',storeId:'store_b'})).status,403);
  for(const route of ['/api/accounts','/api/settings'])assert.equal((await call(route,c)).status,403);
  assert.equal((await call('/api/todos',c,'POST',{title:'越权派单',ownerId:'m0',storeId:'store_b'})).status,403);
 }
 assert.equal((await call('/api/todos',cookies.hq)).data.todos.length,2);assert.equal((await call('/api/accounts',cookies.hq)).status,403);
 assert.equal((await call('/api/accounts/m2',cookies.admin,'PUT',{username:'east',role:'region',regions:['不存在']})).status,400);
 assert.equal((await call('/api/accounts/m3',cookies.admin,'PUT',{username:'shop',role:'store',storeIds:[]})).status,400);
 assert.equal((await call('/api/accounts/m2',cookies.admin,'PUT',{username:'east',role:'region',regions:['华西']})).status,200);
 assert.equal((await call('/api/todos',cookies.east)).status,401);
 const changed=(await call('/api/auth/login','','POST',{username:'east',password:'Password-123'})).cookie;
 assert.deepEqual((await call('/api/todos',changed)).data.todos.map(t=>t.id),['todo_b']);
});
