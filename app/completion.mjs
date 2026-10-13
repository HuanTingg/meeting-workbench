import {canSeeTask,managesStore,canOperate} from './permissions.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function createCompletion(db,save,dataDir,onEvent=()=>{}){
  const folder=path.join(dataDir,'completion-files');fs.mkdirSync(folder,{recursive:true});
  const permitted=(t,a)=>canSeeTask(db,a,t);
  function task(id,a){const t=db.todos.find(t=>t.id===id);if(!t||!permitted(t,a))fail('待办不存在或无权访问',404);return t;}
  async function update(id,b,a){
    const t=task(id,a);if(!b.action&&typeof b.done!=='boolean')fail('任务状态无效');
    const workflow=!!t.reviewerId;
    const at=new Date().toISOString();
    const event=(action,note='',extra={})=>{const recipients=action==='submit'?[t.reviewerId,t.dispatchedBy]:action==='transfer'?[extra.previousOwnerId,t.ownerId,t.dispatchedBy,t.reviewerId]:[t.ownerId,t.dispatchedBy,t.reviewerId];t.timeline??=[];t.timeline.push({id:'event_'+randomUUID().replaceAll('-',''),action,at,memberId:a.memberId,actorName:db.members.find(m=>m.id===a.memberId)?.name||a.username,note,recipientIds:[...new Set(recipients.filter(Boolean))],...extra});t.updatedAt=at;};
    if(b.action){
      if(b.action==='approve'||b.action==='reject'){
        if(t.reviewerId!==a.memberId)fail('仅指定验收人可以验收',403);
        if(t.status!=='pending_review')fail('任务当前不在待验收状态',409);
        const note=typeof b.note==='string'?b.note.trim().slice(0,2000):'';
        if(b.action==='reject'&&!note)fail('请填写退回原因');
        t.done=b.action==='approve';t.status=t.done?'completed':'in_progress';t.completedAt=t.done?at:null;
        event(b.action,note);onEvent(t,t.timeline?.at(-1));await save();return t;
      }
      if(!managesStore(db,a,t.storeId)&&t.ownerId!==a.memberId&&t.dispatchedBy!==a.memberId)fail('无权操作此任务',403);
      if(t.done||t.status==='pending_review')fail('请先完成验收或退回处理',409);
      const note=typeof b.note==='string'?b.note.trim().slice(0,2000):'';
      if(b.action==='transfer'){
        if(!note)fail('转移任务必须填写原因');
        if(!db.members.some(m=>m.id===b.ownerId&&m.employmentStatus!=='departed')||b.ownerId===t.ownerId)fail('请选择不同的有效负责人');
        const next=db.accounts.find(x=>x.memberId===b.ownerId);
        if(next?.disabled)fail('接任账号已停用');
        if(next&&!canOperate(next,'edit'))fail('接任账号无任务处理权限');
        if(!canSeeTask(db,next||{role:'member',memberId:b.ownerId},{...t,ownerId:b.ownerId}))fail('接任人无权查看该任务及关联资料，请先确认访问权限');
        const previousOwnerId=t.ownerId;t.ownerId=b.ownerId;t.status='pending_acceptance';t.acceptedAt=null;t.blockReason='';t.responseDueAt=new Date(Date.now()+Number(db.businessRules?.responseHours||24)*3600000).toISOString();event('transfer',note,{previousOwnerId,ownerId:t.ownerId});
      }else if(b.action==='progress'){
        if(!note)fail('请填写处理进展');if(t.status&&!['in_progress','blocked'].includes(t.status))fail('请先接单或完成退回补充后再记录进展',409);event('progress',note);
      }else fail('操作无效');
      onEvent(t,t.timeline?.at(-1));await save();return t;
    }
    if(!managesStore(db,a,t.storeId)&&t.ownerId!==a.memberId)fail('仅执行人可以提交完成',403);
    if(b.done&&['pending_acceptance','returned','blocked'].includes(t.status))fail('请先接单、补充资料或解除阻塞后再提交',409);
    if(workflow&&t.status==='pending_review')fail('任务已提交，等待验收',409);
    if(t.done===b.done)return t;
    let attachment=null;
    if(b.done&&b.attachment){
      const f=b.attachment;const name=typeof f.name==='string'?f.name.replace(/[\x00-\x1f\\/]/g,'_').slice(0,180):'';
      const ext=path.extname(name).toLowerCase();
      if(!name||!['.pdf','.png','.jpg','.jpeg','.webp','.txt','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.zip'].includes(ext))fail('附件支持图片、PDF、Office文档、TXT或ZIP');
      if(typeof f.base64!=='string'||f.base64.length>14*1024*1024||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.base64))fail('附件数据无效或超过10MB');
      const bytes=Buffer.from(f.base64,'base64');if(!bytes.length||bytes.length>10*1024*1024)fail('附件不能为空且不能超过10MB');
      const fileId='proof_'+randomUUID().replaceAll('-','');fs.writeFileSync(path.join(folder,fileId),bytes,{flag:'wx',mode:0o600});attachment={id:fileId,name,size:bytes.length};
    }
    const record={id:'completion_'+randomUUID().replaceAll('-',''),done:b.done,at:new Date().toISOString(),memberId:a.memberId,actorName:db.members.find(m=>m.id===a.memberId)?.name||a.username,note:typeof b.note==='string'?b.note.trim().slice(0,2000):'',attachment};
    t.completions??=[];t.completions.push(record);t.done=workflow?false:b.done;t.status=workflow&&b.done?'pending_review':b.done?'completed':'in_progress';t.updatedAt=record.at;t.completedAt=t.done?record.at:null;event(b.done?'submit':'reopen',record.note);record.status=t.status;
    onEvent(t,t.timeline?.at(-1));await save();return t;
  }
  function download(id,fileId,a,res){const t=task(id,a);const f=t.completions?.map(c=>c.attachment).find(f=>f?.id===fileId);if(!f||!/^proof_[a-f0-9]{32}$/.test(fileId))fail('附件不存在',404);const file=path.join(folder,fileId);if(!fs.existsSync(file))fail('附件文件不存在',404);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="proof"; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Content-Length':fs.statSync(file).size,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);}
  return {update,download};
}
