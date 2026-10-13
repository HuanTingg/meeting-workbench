export function repetitionSummary(issues,tasks,meetings){
 const byId=new Map(meetings.map(m=>[m.id,m]));
 const repeated=issues.filter(i=>i.kind!=='routine'&&i.status!=='dismissed').map(i=>{
  const sources=[...new Set(i.meetingIds||[])].map(id=>byId.get(id)).filter(Boolean).sort((a,b)=>a.meetingDate.localeCompare(b.meetingDate));
  return {id:i.id,title:i.title,status:i.status,recurrences:Math.max(0,(i.cycle||1)-1),count:sources.length,firstDate:sources[0]?.meetingDate,lastDate:sources.at(-1)?.meetingDate,storeIds:[...new Set(sources.map(m=>m.storeId).filter(Boolean))],meetingIds:sources.map(m=>m.id)};
 }).filter(i=>i.count>1).sort((a,b)=>b.count-a.count);
 const groups=new Map();
 for(const t of tasks){
  if(!byId.has(t.meetingId)||!t.storeId)continue;
  const date=t.executionDate||(/Z$|[+-]\d{2}:\d{2}$/.test(t.dueAt||'')?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(t.dueAt)):(t.dueAt||'').slice(0,10));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))continue;
  const title=t.title.trim().replace(/\s+/g,' ').toLowerCase(),key=JSON.stringify([t.storeId,title,date]);
  const g=groups.get(key)||{title:t.title,storeId:t.storeId,date,taskIds:[]};g.taskIds.push(t.id);groups.set(key,g);
 }
 return {repeated,duplicates:[...groups.values()].filter(g=>g.taskIds.length>1)};
}
