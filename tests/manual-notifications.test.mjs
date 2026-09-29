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
