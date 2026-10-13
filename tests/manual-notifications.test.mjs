import {test} from 'node:test';import assert from 'node:assert/strict';
import {createDingTalk} from '../app/dingtalk.mjs';import {createFeishu} from '../app/feishu.mjs';
test('manual todos enqueue independently for both channels and providers, with stable dedup',()=>{
 const db={members:[{id:'owner',name:'负责人'}],todos:[],dingtalk:{groupEnabled:true,personalEnabled:true,keyword:'会议任务'},feishu:{groupEnabled:true,personalEnabled:true}};
 const ding=createDingTalk(db,()=>{},()=>{throw Error('Do not send');});const fei=createFeishu(db,()=>{},()=>{throw Error('Do not send');});
 const todo={id:'todo_a',ownerId:'owner',title:'交付报告',description:'附测试结果',dueAt:'2026-10-01',priority:'high'};
 for(const provider of [ding,fei]){provider.enqueueTodo(todo);provider.enqueueTodo(todo);}
 assert.equal(db.notifications.length,4);assert.equal(ding.list().length,2);assert.equal(fei.list().length,2);
 for(const n of db.notifications){assert.equal(n.todoId,todo.id);assert.equal(n.meetingId,'');assert.match(n.content,/交付报告/);assert.match(n.content,/附测试结果/);assert.match(n.content,/2026-10-01/);assert.equal(n.ownerId,n.channel==='personal'?'owner':'');}
 ding.enqueueTodo({...todo,id:'todo_b'});assert.equal(ding.list().length,4);
 db.feishu.groupEnabled=false;db.feishu.personalEnabled=false;fei.enqueueTodo({...todo,id:'todo_c'});assert.equal(fei.list().length,2);
});
test('workflow notifications target reviewer or transfer participants and deduplicate per event',()=>{
 const db={members:[{id:'old',name:'旧执行人'},{id:'new',name:'新执行人'},{id:'review',name:'验收人'}],todos:[],dingtalk:{groupEnabled:true,personalEnabled:true},feishu:{groupEnabled:true,personalEnabled:true}};
 const providers=[createDingTalk(db,()=>{},()=>{throw Error('No sending');}),createFeishu(db,()=>{},()=>{throw Error('No sending');})];
 const todo={id:'todo_a',title:'整改',ownerId:'new',reviewerId:'review'};
 for(const p of providers){p.enqueueEvent(todo,{id:'e1',action:'transfer',previousOwnerId:'old',note:'交接'});p.enqueueEvent(todo,{id:'e1',action:'transfer',previousOwnerId:'old',note:'交接'});assert.equal(p.list().length,3);p.enqueueEvent(todo,{id:'e2',action:'submit'});assert.equal(p.list().length,5);assert.ok(p.list().some(n=>n.ownerId==='review'&&n.content.includes('待验收')));}
});
