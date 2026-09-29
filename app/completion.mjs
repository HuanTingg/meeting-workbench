import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function createCompletion(db,save,dataDir){
  const folder=path.join(dataDir,'completion-files');fs.mkdirSync(folder,{recursive:true});
  const permitted=(t,a)=>a.role==='manager'||t.ownerId===a.memberId;
  function task(id,a){const t=db.todos.find(t=>t.id===id);if(!t||!permitted(t,a))fail('待办不存在或无权访问',404);return t;}
  async function update(id,b,a){
    const t=task(id,a);if(typeof b.done!=='boolean')fail('任务状态无效');
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
    t.completions??=[];t.completions.push(record);t.done=b.done;t.updatedAt=record.at;t.completedAt=b.done?record.at:null;
    await save();return t;
  }
  function download(id,fileId,a,res){const t=task(id,a);const f=t.completions?.map(c=>c.attachment).find(f=>f?.id===fileId);if(!f||!/^proof_[a-f0-9]{32}$/.test(fileId))fail('附件不存在',404);const file=path.join(folder,fileId);if(!fs.existsSync(file))fail('附件文件不存在',404);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="proof"; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Content-Length':fs.statSync(file).size,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);}
  return {update,download};
}
