import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {operationCollections,operationDefaults} from './operations.mjs';
import {canEditMeeting,canSeeMeeting,canOperate,managesStore} from './permissions.mjs';
const fail=(m,status=400)=>{throw Object.assign(Error(m),{status});};
const clean=(x,n=200)=>typeof x==='string'?x.trim().slice(0,n):'';
const uid=p=>p+randomUUID().replaceAll('-','');
export function createRecords(db,save,dataDir){
 const attachmentDir=path.join(dataDir,'meeting-files');fs.mkdirSync(attachmentDir,{recursive:true});
 async function handle(route,method,a,b,res){
  const match=route.match(/^\/api\/workspace\/meetings\/(meeting_[a-f0-9]+)\/(metadata|files|revisions|export)(?:\/(file_[a-f0-9]+))?$/);if(!match)return null;
  const m=db.meetings.find(m=>m.id===match[1]);if(!m||!canSeeMeeting(db,a,m))fail('会议无权访问',404);
  const action=match[2];if(method!=='GET'&&!canEditMeeting(db,a,m))fail('无权修改会议',403);
  if(action==='metadata'){
   if(method==='GET')return {meeting:m};
   const participantIds=Array.isArray(b.participantIds)?[...new Set(b.participantIds)]:[];
   if(participantIds.some(id=>!db.members.some(x=>x.id===id))||b.hostId&&!db.members.some(x=>x.id===b.hostId))fail('主持人或参会成员无效');
   const allowedMemberIds=Array.isArray(b.allowedMemberIds)?b.allowedMemberIds.filter(id=>db.members.some(x=>x.id===id)):[];
   if(b.sensitivity==='restricted'&&!allowedMemberIds.includes(a.memberId))allowedMemberIds.push(a.memberId);
   const before={storeId:m.storeId,meetingType:m.meetingType,hostId:m.hostId,participantIds:m.participantIds,sensitivity:m.sensitivity,allowedMemberIds:m.allowedMemberIds};
   if('storeId' in b){if(b.storeId&&!db.stores.some(s=>s.id===b.storeId))fail('门店不存在');if(['region','store'].includes(a.role)&&!managesStore(db,a,b.storeId))fail('门店不在负责范围内',403);m.storeId=clean(b.storeId);for(const t of db.todos.filter(t=>t.meetingId===m.id&&!t.storeId))t.storeId=m.storeId;for(const i of db.issues.filter(i=>i.meetingIds.includes(m.id)&&!i.storeId))i.storeId=m.storeId;}
   Object.assign(m,{meetingType:clean(b.meetingType,100),hostId:clean(b.hostId),participantIds,topics:(Array.isArray(b.topics)?b.topics:[]).map(x=>clean(x,100)).slice(0,30),department:clean(b.department,100),sensitivity:b.sensitivity==='restricted'?'restricted':'normal',allowedMemberIds,updatedAt:new Date().toISOString()});m.metadataHistory??=[];m.metadataHistory.push({at:m.updatedAt,memberId:a.memberId,before});await save();return {meeting:m};
  }
  if(action==='revisions')return {original:m.originalTranscript??m.transcript,current:m.transcript,revisions:m.revisions||[]};
  if(action==='export'){
   if(!canOperate(a,'export'))fail('没有导出权限',403);return {filename:m.title+'.md',content:`# ${m.title}\n\n日期：${m.meetingDate}\n类型：${m.meetingType||'未填写'}\n\n## 摘要\n${m.summary}\n\n## 原文\n${m.transcript}`};
  }
  if(action==='files'){
   if(method==='GET'&&!match[3])return {files:m.attachments||[]};
   if(method==='GET'){
    if(!canOperate(a,'export'))fail('没有下载权限',403);const f=m.attachments?.find(f=>f.id===match[3]);if(!f)fail('附件不存在',404);const file=path.join(attachmentDir,f.id);if(!fs.existsSync(file))fail('附件文件缺失',404);res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Content-Length':f.size,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);return {streamed:true};
   }
   if(method==='POST'){
    if(!canOperate(a,'upload'))fail('没有上传权限',403);const name=clean(b.name,180).replace(/[\\/\x00-\x1f]/g,'_');if(!/\.(pdf|docx?|xlsx?|pptx?|png|jpe?g|webp|txt|md|zip)$/i.test(name))fail('附件格式不支持');if(typeof b.base64!=='string'||b.base64.length>28*1024*1024||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.base64))fail('附件无效或超过20MB');const bytes=Buffer.from(b.base64,'base64');if(!bytes.length||bytes.length>20*1024*1024)fail('附件为空或超过20MB');const hash=createHash('sha256').update(bytes).digest('hex');m.attachments??=[];const old=m.attachments.find(f=>f.hash===hash);if(old)return {file:old,duplicate:true};const f={id:uid('file_'),name,size:bytes.length,hash,at:new Date().toISOString(),uploadedBy:a.memberId};fs.writeFileSync(path.join(attachmentDir,f.id),bytes,{flag:'wx'});m.attachments.push(f);await save();return {file:f};
   }
  }
  return null;
 }
 return {handle};
}
export function createBackups(db,save,dataDir){
 const root=path.join(dataDir,'backups','complete');fs.mkdirSync(root,{recursive:true});
 const roots=['uploads','completion-files','meeting-files'];
 const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 function create(){
  const id=uid('backup_'),folder=path.join(root,id);fs.mkdirSync(folder);const files=[];
  try{fs.writeFileSync(path.join(folder,'database.json'),JSON.stringify(db),{mode:0o600});files.push({name:'database.json',hash:hash(path.join(folder,'database.json'))});
   for(const name of roots){const src=path.join(dataDir,name);fs.mkdirSync(path.join(folder,name));if(!fs.existsSync(src))continue;for(const entry of fs.readdirSync(src,{withFileTypes:true})){if(!entry.isFile())continue;const relative=name+'/'+entry.name;fs.copyFileSync(path.join(src,entry.name),path.join(folder,relative));files.push({name:relative,hash:hash(path.join(folder,relative))});}}
   const manifest={id,at:new Date().toISOString(),version:1,files};fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(manifest));return {id,at:manifest.at,fileCount:files.length};
  }catch(e){throw Object.assign(Error('备份失败，未完成的备份不会列入可恢复列表'),{status:500});}
 }
 function verify(id){
  if(!/^backup_[a-f0-9]{32}$/.test(id))fail('备份编号无效');const folder=path.join(root,id);if(!fs.existsSync(path.join(folder,'manifest.json')))fail('备份不存在',404);const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
  for(const f of manifest.files){if(f.name!=='database.json'&&!/^(uploads|completion-files|meeting-files)\/[A-Za-z0-9_.-]+$/.test(f.name))fail('备份路径无效');const file=path.join(folder,f.name);if(!fs.existsSync(file)||hash(file)!==f.hash)fail('备份校验失败：'+f.name);}
  const state=JSON.parse(fs.readFileSync(path.join(folder,'database.json'),'utf8'));if(!Array.isArray(state.accounts)||!Array.isArray(state.members)||!Array.isArray(state.meetings)||!Array.isArray(state.todos))fail('备份数据结构无效');return {folder,manifest,state};
 }
 async function restore(id){
  const {folder,manifest,state}=verify(id);const before=create();
  for(const k of operationCollections)state[k]??=[];state.businessRules={...operationDefaults,...state.businessRules};state.mail??={enabled:false,host:'',port:465,secure:true,user:'',password:'',from:''};
  for(const m of state.meetings)if(m.status==='processing'){m.status='failed';m.errorMessage='恢复备份后请重新解析';}
  // Existing files remain recoverable; restore only verified files into controlled data folders.
  for(const name of roots)fs.mkdirSync(path.join(dataDir,name),{recursive:true});
  for(const f of manifest.files)if(f.name!=='database.json')fs.copyFileSync(path.join(folder,f.name),path.join(dataDir,f.name));
  for(const row of [...(state.notifications||[]),...(state.serviceEvents||[])])if(['pending','sending'].includes(row.status)){row.status='unknown';row.error='从备份恢复，需确认是否已经发送';row.message=row.error;}
  for(const a of state.accounts)a.version=Math.max(a.version||0,db.accounts.find(x=>x.id===a.id)?.version||0)+1;
  const old=structuredClone(db);try{for(const k of Object.keys(db))delete db[k];Object.assign(db,state);await save();}catch(e){for(const k of Object.keys(db))delete db[k];Object.assign(db,old);throw e;}
  return {restored:id,safetyBackup:before.id,relogin:true};
 }
 function list(){return fs.readdirSync(root).filter(n=>/^backup_[a-f0-9]{32}$/.test(n)&&fs.existsSync(path.join(root,n,'manifest.json'))).map(n=>{const m=JSON.parse(fs.readFileSync(path.join(root,n,'manifest.json'),'utf8'));return {id:n,at:m.at,fileCount:m.files.length};}).sort((a,b)=>b.at.localeCompare(a.at));}
 return {create,verify,restore,list};
}
