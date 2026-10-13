export const roleLabels={manager:'系统管理员',head:'总部负责人',department:'部门负责人',region:'大区负责人',store:'门店负责人',member:'普通成员'};
export const operationNames=['view','upload','dispatch','edit','review','export'];
export function canOperate(a,key){if(!a)return false;if(a.role==='manager')return true;if(typeof a.permissions?.[key]==='boolean')return a.permissions[key];return key!=='dispatch'||a.role!=='member';}
export function globalBusiness(a){return ['manager','head'].includes(a.role);}
export function sensitiveAllowed(a,item){return a.role==='manager'||item.sensitivity!=='restricted'||(item.allowedMemberIds||[]).includes(a.memberId);}
export function managesStore(db,a,id){
 if(globalBusiness(a))return true;const store=db.stores?.find(s=>s.id===id);if(!store)return false;
 return a.role==='region'&&(a.regions||[]).includes(store.region)||a.role==='store'&&(a.storeIds||[]).includes(id);
}
export function canSeeTask(db,a,t){
 if(!canOperate(a,'view')||!sensitiveAllowed(a,t))return false;
 const issue=db.issues?.find(i=>i.id===t.issueId);if(issue&&(!sensitiveAllowed(a,issue)||(issue.meetingIds||[]).some(id=>{const m=db.meetings?.find(m=>m.id===id);return m&&!sensitiveAllowed(a,m);})))return false;
 const meeting=db.meetings?.find(m=>m.id===t.meetingId);if(meeting&&!sensitiveAllowed(a,meeting))return false;
 return managesStore(db,a,t.storeId)||[t.ownerId,t.reviewerId,t.dispatchedBy,...(t.collaboratorIds||[])].includes(a.memberId)||a.role==='department'&&(a.departments||[]).includes(t.department||db.members.find(m=>m.id===t.ownerId)?.department);
}
export function canEditMeeting(db,a,m){return canOperate(a,'edit')&&sensitiveAllowed(a,m)&&(m.uploadedBy===a.memberId||managesStore(db,a,m.storeId)||a.role==='department'&&(a.departments||[]).includes(m.department));}
export function canSeeMeeting(db,a,m){
 if(!canOperate(a,'view')||!sensitiveAllowed(a,m))return false;
 if(m.uploadedBy===a.memberId||managesStore(db,a,m.storeId)||a.role==='department'&&(a.departments||[]).includes(m.department))return true;
 if(db.todos.some(t=>t.meetingId===m.id&&canSeeTask(db,a,t)))return true;
 if(m.status!=='published')return false;
 if(a.role==='member'&&!db.businessRules?.strictMeetingScope)return true;
 if(a.role==='member'&&db.members.find(p=>p.id===a.memberId)?.storeId===m.storeId&&m.storeId)return true;
 return db.todos.some(t=>t.meetingId===m.id&&canSeeTask(db,a,t));
}
export function notificationAllowed(db,row){
 const recipient=row.ownerId||row.recipientId;
 const a=db.accounts?.find(a=>a.memberId===recipient)||{role:'member',memberId:recipient};
 if(row.channel!=='group'&&(a.disabled||!canOperate(a,'view')||db.members?.some(m=>m.id===recipient&&m.employmentStatus==='departed')))return false;
 const t=db.todos?.find(t=>t.id===row.todoId),m=db.meetings?.find(m=>m.id===(t?.meetingId||row.meetingId)),i=db.issues?.find(i=>i.id===t?.issueId);
 const restricted=[t,m,i,...(i?.meetingIds||[]).map(id=>db.meetings?.find(m=>m.id===id))].filter(x=>x?.sensitivity==='restricted');
 if(!restricted.length)return true;if(row.channel==='group')return false;
 return !a.disabled&&canOperate(a,'view')&&restricted.every(x=>sensitiveAllowed(a,x));
}
