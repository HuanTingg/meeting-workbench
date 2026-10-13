import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createCompletion} from '../app/completion.mjs';
import {notificationAllowed} from '../app/permissions.mjs';

test('Transfers reject disabled and unauthorized recipients without changing ownership',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-transfer-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const owner={memberId:'old',role:'member'},next={memberId:'next',role:'member',disabled:true};
 const task={id:'task',ownerId:'old',reviewerId:'review',dispatchedBy:'manager',status:'in_progress',done:false,sensitivity:'restricted',allowedMemberIds:['old','review'],timeline:[]};
 const db={members:[{id:'old'},{id:'next'}],accounts:[owner,next],todos:[task],stores:[],meetings:[],issues:[]};const events=[];
 const completion=createCompletion(db,async()=>{},dir,(t,e)=>events.push(e));
 await assert.rejects(completion.update('task',{action:'transfer',ownerId:'next',note:'交接'},owner),/停用/);
 next.disabled=false;await assert.rejects(completion.update('task',{action:'transfer',ownerId:'next',note:'交接'},owner),/无权/);
 assert.equal(task.ownerId,'old');assert.equal(events.length,0);
 task.allowedMemberIds.push('next');await completion.update('task',{action:'transfer',ownerId:'next',note:'交接'},owner);
 assert.equal(task.status,'pending_acceptance');assert.equal(task.acceptedAt,null);assert.deepEqual(new Set(events[0].recipientIds),new Set(['old','next','manager','review']));
 await assert.rejects(completion.update('task',{action:'progress',note:'绕过接单'},next),/先接单/);
 assert.equal(task.status,'pending_acceptance');
});

test('Personal feedback cannot be sent to disabled accounts or departed members, including normal tasks',()=>{
 const db={members:[{id:'x'}],accounts:[{memberId:'x',role:'member',disabled:true}],todos:[],meetings:[],issues:[]};
 assert.equal(notificationAllowed(db,{channel:'personal',ownerId:'x'}),false);
 db.accounts[0].disabled=false;db.members[0].employmentStatus='departed';assert.equal(notificationAllowed(db,{channel:'personal',recipientId:'x'}),false);
 db.members[0].employmentStatus='active';assert.equal(notificationAllowed(db,{channel:'personal',ownerId:'x'}),true);
});
