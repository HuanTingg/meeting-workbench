import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperations} from '../app/operations.mjs';
const admin={id:'admin',role:'manager',memberId:'a'};
function setup(){const db={members:[{id:'a'},{id:'w',position:'维修'},{id:'r',position:'维修'}],accounts:[admin,{id:'worker',role:'member',memberId:'w'},{id:'reviewer',role:'member',memberId:'r'}],stores:[],meetings:[],todos:[],issues:[],businessRules:{remindersEnabled:true}};const events=[];const op=createOperations(db,async()=>{},{notify:(t,e)=>events.push(e)});return {db,op,events};}
test('P0 audit: submitted tasks do not receive execution overdue reminders',async()=>{
 const {db,op,events}=setup();db.todos.push({id:'todo_a',issueId:'issue_a',ownerId:'w',reviewerId:'r',dispatchedBy:'a',status:'pending_review',done:false,dueAt:'2026-10-01'});
 await op.tick(new Date('2026-10-12T00:00:00Z'));assert.equal(events.length,0);
 db.todos[0].status='in_progress';await op.tick(new Date('2026-10-12T00:01:00Z'));await op.tick(new Date('2026-10-12T00:02:00Z'));assert.equal(events.length,1);
});
test('P0 audit: bulk handover validates every task before changing any record',async()=>{
 const {db,op,events}=setup();db.todos.push({id:'todo_a',ownerId:'w',reviewerId:'a',done:false},{id:'todo_b',ownerId:'w',reviewerId:'a',done:false,sensitivity:'restricted',allowedMemberIds:['w']});
 await assert.rejects(op.handle('/api/admin/handover','POST',admin,{from:'w',to:'r',note:'离职',depart:true}),/无权查看/);
 assert.ok(db.todos.every(t=>t.ownerId==='w'));assert.equal(events.length,0);assert.equal(db.accounts[1].disabled,undefined);
 db.todos[1].allowedMemberIds.push('r');db.accounts[2].permissions={edit:false};await assert.rejects(op.handle('/api/admin/handover','POST',admin,{from:'w',to:'r',note:'交接'}),/处理权限/);
 db.accounts[2].permissions={edit:true};await op.handle('/api/admin/handover','POST',admin,{from:'w',to:'r',note:'交接'});assert.ok(db.todos.every(t=>t.ownerId==='r'));assert.ok(events.every(e=>e.recipientIds.includes('r')&&e.recipientIds.includes('a')));
});
test('P0 audit: ambiguous or disabled position matches require explicit assignment',async()=>{
 const {db,op}=setup();db.issues.push({id:'issue_a',createdBy:'a',meetingIds:[],title:'维修',status:'pending_assignment'});db.businessRules.routing=[{position:'维修'}];
 assert.equal((await op.handle('/api/workspace/issues/issue_a','GET',admin)).route.ownerId,'');
 db.accounts[1].disabled=true;assert.equal((await op.handle('/api/workspace/issues/issue_a','GET',admin)).route.ownerId,'r');
 db.accounts[2].permissions={edit:false};assert.equal((await op.handle('/api/workspace/issues/issue_a','GET',admin)).route.ownerId,'');
});
test('P0 audit: snapshot cannot bypass newly restricted task access',async()=>{
 const {db,op}=setup();const task={id:'todo_a',ownerId:'w',done:false,title:'历史任务'};db.todos.push({...task,sensitivity:'restricted',allowedMemberIds:['a']});db.dailySnapshots.push({id:'snapshot_a',day:'2026-10-11',tasks:[task],issues:[]});
 const r=await op.handle('/api/workspace/snapshot','GET',db.accounts[1],{},new URL('http://localhost/?id=snapshot_a'));assert.equal(r.snapshot.tasks.length,0);
});
test('P0 audit: cross-meeting evidence keeps timestamps and invalid revisions block dispatch',async()=>{
 const {db,op}=setup();db.meetings.push({id:'meeting_a',uploadedBy:'a',transcript:'冷柜损坏',transcriptSegments:[{text:'冷柜损坏',start:12,end:15,speakerLabel:'发言人0'}],tasks:[]},{id:'meeting_b',uploadedBy:'a',transcript:'配件到货',tasks:[]});
 const i=(await op.handle('/api/workspace/issues','POST',admin,{title:'冷柜维修',meetingId:'meeting_a',excerpt:'冷柜损坏'})).issue;
 assert.equal(i.evidence[0].start,12);assert.equal(i.evidence[0].speakerLabel,'发言人0');
 await op.handle('/api/workspace/issues/'+i.id,'PATCH',admin,{action:'link',meetingId:'meeting_b',excerpt:'配件到货'});assert.equal(i.meetingIds.length,2);assert.equal(i.evidence.length,2);
 await op.handle('/api/workspace/issues/'+i.id,'PATCH',admin,{action:'confirm'});db.meetings[0].transcript='原文已修正';op.reconcileMeeting(db.meetings[0]);assert.equal(i.needsSourceReview,true);
 await assert.rejects(op.handle('/api/workspace/issues/'+i.id,'PATCH',admin,{action:'dispatch',requestId:'test',tasks:[{title:'维修',ownerId:'w'}]}),/原文已修改/);assert.equal(db.todos.length,0);
});
test('P0 audit: awaiting, upcoming and overdue reminders deduplicate per day',async()=>{
 const {db,op,events}=setup();db.businessRules.escalationHours=48;const base={issueId:'issue_a',ownerId:'w',dispatchedBy:'a',done:false};db.todos.push({...base,id:'todo_a',status:'pending_acceptance',responseDueAt:'2026-10-11T23:00:00Z',dueAt:'2026-10-14T00:00:00Z'},{...base,id:'todo_b',status:'in_progress',dueAt:'2026-10-12T10:00:00Z'},{...base,id:'todo_c',status:'in_progress',dueAt:'2026-10-11T23:00:00Z'});
 await op.tick(new Date('2026-10-12T00:00:00Z'));await op.tick(new Date('2026-10-12T00:01:00Z'));assert.deepEqual(events.map(e=>e.action),['awaiting','upcoming','overdue']);assert.ok(events.every(e=>e.recipientIds.join()==='w'));
});


test('P0 audit: review reminders target reviewer, wait for threshold and deduplicate each submission',async()=>{
 const {db,op,events}=setup();const t={id:'todo_review',issueId:'issue_a',ownerId:'w',reviewerId:'r',dispatchedBy:'a',status:'pending_review',done:false,dueAt:'2026-10-01',timeline:[{id:'submit1',action:'submit',at:'2026-10-11T00:00:00Z'}]};db.todos.push(t);
 await op.tick(new Date('2026-10-11T23:59:00Z'));assert.equal(events.length,0);
 await op.tick(new Date('2026-10-12T00:00:00Z'));await op.tick(new Date('2026-10-12T00:01:00Z'));assert.equal(events.length,1);assert.equal(events[0].action,'review_waiting');assert.deepEqual(events[0].recipientIds,['r']);
 t.timeline.push({id:'submit2',action:'submit',at:'2026-10-12T01:00:00Z'});await op.tick(new Date('2026-10-12T02:00:00Z'));assert.equal(events.length,1);
 await op.tick(new Date('2026-10-13T01:00:00Z'));assert.equal(events.length,2);assert.notEqual(events[0].id,events[1].id);
 db.accounts[2].disabled=true;await op.tick(new Date('2026-10-14T02:00:00Z'));assert.equal(events.length,2);
 db.accounts[2].disabled=false;t.done=true;t.status='completed';await op.tick(new Date('2026-10-15T02:00:00Z'));assert.equal(events.length,2);
});
test('P0 audit: acknowledgement informs the collaborator who initiated handoff',async()=>{
 const {db,op,events}=setup();db.todos.push({id:'todo_abcd',ownerId:'w',dispatchedBy:'a',collaboratorIds:['r'],status:'in_progress',done:false,handoffs:[{id:'handoff_a',from:'r',to:'w',status:'pending'}]});
 await op.handle('/api/workspace/tasks/todo_abcd','POST',db.accounts[1],{action:'acknowledge',handoffId:'handoff_a',note:'收到配件'});
 assert.ok(events[0].recipientIds.includes('r'));assert.equal(db.todos[0].handoffs[0].status,'accepted');
});

test('P0 audit: historical task configuration validates reviewer permissions and evidence access',async()=>{
 const {db,op}=setup();db.stores.push({id:'store_a'});const t={id:'todo_ac',ownerId:'w',done:false,sensitivity:'restricted',allowedMemberIds:['a','w']};db.todos.push(t);
 db.accounts[2].permissions={review:false};await assert.rejects(op.handle('/api/workspace/tasks/todo_ac','POST',admin,{action:'configure',storeId:'store_a',reviewerId:'r'}),/验收权限/);
 db.accounts[2].permissions={review:true};await assert.rejects(op.handle('/api/workspace/tasks/todo_ac','POST',admin,{action:'configure',storeId:'store_a',reviewerId:'r'}),/无权查看/);assert.equal(t.reviewerId,undefined);
 t.allowedMemberIds.push('r');await op.handle('/api/workspace/tasks/todo_ac','POST',admin,{action:'configure',storeId:'store_a',reviewerId:'r'});assert.equal(t.reviewerId,'r');
});

test('P0 audit: editing legacy AI categories preserves original but validates changed classifications',async()=>{
 const {db,op}=setup();db.issues.push({id:'issue_abcd',createdBy:'a',meetingIds:[],title:'培训内容',category:'培训设计',status:'pending_confirmation',description:'旧描述'});
 const detail=await op.handle('/api/workspace/issues/issue_abcd','GET',admin);assert.deepEqual(detail.categories,db.businessRules.categories);
 await op.handle('/api/workspace/issues/issue_abcd','PATCH',admin,{action:'edit',category:'培训设计',description:'修正描述'});assert.equal(db.issues[0].description,'修正描述');assert.equal(db.issues[0].category,'培训设计');
 await op.handle('/api/workspace/issues/issue_abcd','PATCH',admin,{action:'edit',description:'仅修改说明'});assert.equal(db.issues[0].category,'培训设计');
 await assert.rejects(op.handle('/api/workspace/issues/issue_abcd','PATCH',admin,{action:'edit',category:'随意分类',description:'不应保存'}),/重新选择/);assert.equal(db.issues[0].description,'仅修改说明');
 await op.handle('/api/workspace/issues/issue_abcd','PATCH',admin,{action:'edit',category:'人员'});assert.equal(db.issues[0].category,'人员');
 db.businessRules.categories=['其他'];await op.handle('/api/workspace/issues/issue_abcd','PATCH',admin,{action:'edit',category:'人员',description:'配置移除后仍可编辑'});assert.equal(db.issues[0].category,'人员');
});
