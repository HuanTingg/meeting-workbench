import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApplication} from '../app/server.mjs';import {hashPassword} from '../app/auth.mjs';
test('meeting upload defaults follow personnel headquarters or store, preserve explicit choice and headquarters review',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-unit-'));
 const members=[{id:'hq',name:'总部员工',position:'总部'},{id:'staff',name:'门店员工',storeId:'store_a',unitType:'store'},{id:'unknown',name:'待归属'}];
 const accounts=members.map(m=>({id:'account_'+m.id,memberId:m.id,username:m.id,role:'member',passwordHash:hashPassword('Password-123')}));
 fs.writeFileSync(path.join(dir,'workspace.json'),JSON.stringify({members,accounts,stores:[{id:'store_a',name:'A店',region:'华东'}],meetings:[],todos:[]}));
 const server=createApplication({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port;
 for(const member of members){
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'X-Requested-With':'MeetingLocal'},body:JSON.stringify({username:member.id,password:'Password-123'})});const headers={Cookie:login.headers.get('set-cookie').split(';')[0],'X-Requested-With':'MeetingLocal'};
  const listed=await (await fetch(base+'/api/morning-meetings',{headers})).json();assert.equal(listed.members.find(m=>m.id===member.id).storeId,member.storeId);
  const upload=async extra=>{const r=await fetch(base+'/api/morning-meetings/upload?fileName=test.md&meetingDate=2026-10-13'+extra,{method:'POST',headers,body:'测试会议文字'});assert.ok(r.ok,await r.clone().text());return (await r.json()).meeting;};
  const m=await upload('');assert.equal(m.storeId,member.storeId||'');assert.equal(m.unitType,member.id==='hq'?'headquarters':member.id==='staff'?'store':'unassigned');
  if(member.id==='hq'){
   const separate=await upload('&storeId=&unitType=unassigned');assert.notEqual(separate.id,m.id);
   const chosen=await upload('&storeId=store_a&unitType=store');assert.equal(chosen.storeId,'store_a');
   const review=await fetch(base+'/api/morning-meetings/'+m.id+'/review',{method:'PATCH',headers,body:JSON.stringify({storeId:'',unitType:'headquarters',transcript:'测试会议文字',summary:'',speakers:[],tasks:[]})});assert.equal(review.status,200);assert.equal((await review.json()).meeting.unitType,'headquarters');
  }
 }
});

