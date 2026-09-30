type AnalyticsSelection={title:string;tasks:Todo[]};
let analyticsSelection:AnalyticsSelection|null=null;
const analyticsColors=['#6798dd','#d9878d','#57a68e'];
function analyticsDay(value?:string){
  if(!value)return '';
  const date=new Date(/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T00:00:00+08:00':/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(value)?value.replace(' ','T')+'+08:00':value);
  return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(date):'';
}
function analyticsDeadline(value:string){return Date.parse(value.length===10?value+'T23:59:59.999+08:00':/Z$|[+-]\d{2}:\d{2}$/.test(value)?value:value.replace(' ','T')+'+08:00');}
function analyticsData(tasks:Todo[],start:string,end:string,now=Date.now()){
  const within=(day:string)=>!!day&&day>=start&&day<=end;
  const created=tasks.filter(t=>within(analyticsDay(t.createdAt)));
  const completed=tasks.filter(t=>t.done&&within(analyticsDay(t.completedAt)));
  const late=(t:Todo)=>!t.done&&Number.isFinite(analyticsDeadline(t.dueAt||''))&&analyticsDeadline(t.dueAt)<now;
  const states=[created.filter(t=>!t.done&&!late(t)),created.filter(late),created.filter(t=>t.done)];
  const dated=completed.filter(t=>Number.isFinite(analyticsDeadline(t.dueAt||'')));
  const onTime=dated.filter(t=>Date.parse(t.completedAt!)<=analyticsDeadline(t.dueAt));
  const days:string[]=[];
  for(let ms=Date.parse(start+'T00:00:00Z');ms<=Date.parse(end+'T00:00:00Z')&&days.length<366;ms+=86400000)days.push(new Date(ms).toISOString().slice(0,10));
  return {created,completed,states,dated,onTime,days,late};
}
function analyticsSelect(title:string,tasks:Todo[],scroll=true){
  analyticsSelection={title,tasks};
  qs('#analyticsDetailTitle')!.textContent=title;
  qs('#analyticsDetailCount')!.textContent=`共 ${tasks.length} 项 · 点击任务查看说明及完成证明`;
  qs('#analyticsDetails')!.innerHTML=tasks.length?tasks.map((t,i)=>`<button class="analytics-task" data-analytics-task="${i}"><span><b>${escapeHtml(t.title)}</b><small>${escapeHtml(memberName(t.ownerId))} · 截止 ${escapeHtml(t.dueAt||'未设置')}</small></span><span class="analytics-task-state">${t.done?'已完成':analyticsData([t],'0001-01-01','0001-01-01').late(t)?'逾期待办':'未逾期待办'}</span></button>`).join(''):'<div class="analytics-empty">当前条件下暂无任务</div>';
  qsa<HTMLElement>('[data-analytics-task]').forEach(b=>b.onclick=()=>{const t=tasks[Number(b.dataset.analyticsTask)];openModal('任务详情',`<h3>${escapeHtml(t.title)}</h3><p>${escapeHtml(t.description||'暂无任务说明')}</p><p>负责人：${escapeHtml(memberName(t.ownerId))}</p><p>截止：${escapeHtml(t.dueAt||'未设置')}</p><h3>完成情况</h3>${completionHistory(t)}`,'<button class="btn" data-modal-close>关闭</button>');});
  if(scroll)qs('#analyticsDetailTitle')!.scrollIntoView({behavior:'smooth',block:'center'});
}
function renderAnalytics(){
  const start=qs<HTMLInputElement>('#analyticsStart')!.value,end=qs<HTMLInputElement>('#analyticsEnd')!.value;
  if(!start||!end||start>end||Date.parse(end)-Date.parse(start)>365*86400000)return;
  const data=analyticsData(state.todos,start,end),labels=['未逾期待办','逾期待办','已完成'];
  const manager=currentUser?.role==='manager';
  qs('#analyticsScope')!.textContent=manager?'会议协同 / 团队数据':'会议协同 / 我的数据';
  qs('#analyticsMemberTitle')!.textContent=manager?'成员任务分布':'我的任务分布';
  const missing=state.todos.filter(t=>!analyticsDay(t.createdAt)).length;
  qs('#analyticsPeriodLabel')!.textContent=`${start} — ${end} · 北京时间`+(missing?` · ${missing} 项旧任务缺少创建日期，不计入新增与状态分布`:'');
  const metrics=[{label:'新增任务',value:data.created.length,hint:'期间创建',tasks:data.created},{label:'完成任务',value:data.completed.length,hint:'期间最终完成',tasks:data.completed},{label:'当前逾期',value:data.states[1].length,hint:'期间新增任务中',tasks:data.states[1]},{label:'按时完成率',value:data.dated.length?Math.round(data.onTime.length/data.dated.length*100)+'%':'—',hint:data.dated.length?`${data.onTime.length} / ${data.dated.length} 项有截止时间的完成任务`:'暂无有截止时间的完成任务',tasks:data.dated}];
  qs('#analyticsMetrics')!.innerHTML=metrics.map((m,i)=>`<button class="analytics-metric tone-${i}" data-metric="${i}"><span>${m.label}<i>↗</i></span><strong>${m.value}</strong><small>${m.hint}</small></button>`).join('');
  qsa<HTMLElement>('[data-metric]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.metric),m=metrics[i];analyticsSelect(i===3?'按时完成率 · 参与计算的任务':m.label,m.tasks);});
  // Group long ranges by week to keep chart points readable; counters still use exact dates.
  const size=data.days.length>62?7:1,buckets:Array<{days:string[];created:Todo[];completed:Todo[]}>=[];
  for(let i=0;i<data.days.length;i+=size){const days=data.days.slice(i,i+size);buckets.push({days,created:data.created.filter(t=>days.includes(analyticsDay(t.createdAt))),completed:data.completed.filter(t=>days.includes(analyticsDay(t.completedAt)))});}
  const max=Math.max(1,...buckets.flatMap(b=>[b.created.length,b.completed.length]));
  const x=(i:number)=>54+(buckets.length===1?276:i*552/(buckets.length-1)),y=(n:number)=>208-n/max*160;
  let svg='<svg viewBox="0 0 640 254" role="group" aria-label="新增与完成任务趋势">';
  const ticks=[...new Set([0,Math.ceil(max/2),max])];
  for(const n of ticks)svg+=`<line x1="44" x2="618" y1="${y(n)}" y2="${y(n)}" stroke="#edf0f4"/><text x="34" y="${y(n)+4}" text-anchor="end">${n}</text>`;
  (['created','completed'] as const).forEach((key,k)=>{const color=k?analyticsColors[2]:analyticsColors[0];svg+=`<polyline points="${buckets.map((b,i)=>`${x(i)},${y(b[key].length)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"/>`;buckets.forEach((b,i)=>{const py=y(b[key].length);svg+=`<g role="button" tabindex="0" data-trend="${i}:${key}" aria-label="${b.days[0]}${size>1?'起':''} ${k?'完成':'新增'} ${b[key].length} 项"><title>${b.days[0]}${size>1?' — '+b.days.at(-1):''} · ${k?'完成':'新增'} ${b[key].length} 项</title><circle cx="${x(i)}" cy="${py}" r="8" fill="transparent"/><circle cx="${x(i)}" cy="${py}" r="${k?3:5}" fill="${color}" stroke="white"/></g>`;});});
  buckets.forEach((b,i)=>{if(i===0||i===buckets.length-1||i%Math.max(1,Math.ceil(buckets.length/5))===0)svg+=`<text x="${x(i)}" y="238" text-anchor="middle">${b.days[0].slice(5)}</text>`;});
  svg+='</svg>';
  qs('#analyticsTrend')!.innerHTML=data.created.length||data.completed.length?svg+(size>1?'<p class="analytics-caption">时间跨度较长，按 7 天合并显示</p>':''):'<div class="analytics-empty chart-empty">所选期间暂无新增或完成任务</div>';
  qsa<SVGElement>('[data-trend]').forEach(b=>{const activate=()=>{const [i,k]=b.dataset.trend!.split(':'),bucket=buckets[Number(i)];analyticsSelect(`${bucket.days[0]}${size>1?' — '+bucket.days.at(-1):''} · ${k==='created'?'新增':'完成'}`,bucket[k as 'created'|'completed']);};b.onclick=activate;b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}};});
  let offset=0;const total=data.created.length,circumference=2*Math.PI*64;
  const arcs=data.states.map((tasks,i)=>{const length=total?tasks.length/total*circumference:0;const arc=tasks.length?`<circle data-status="${i}" role="button" tabindex="0" aria-label="${labels[i]} ${tasks.length} 项" cx="90" cy="90" r="64" fill="none" stroke="${analyticsColors[i]}" stroke-width="20" stroke-dasharray="${length} ${circumference-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)"><title>${labels[i]} ${tasks.length} 项</title></circle>`:'';offset+=length;return arc;}).join('');
  qs('#analyticsStatus')!.innerHTML=`<div class="analytics-ring"><svg viewBox="0 0 180 180" role="group" aria-label="任务状态分布"><circle cx="90" cy="90" r="64" fill="none" stroke="#eef1f5" stroke-width="20"/>${arcs}<text x="90" y="88" text-anchor="middle" class="ring-number">${total}</text><text x="90" y="111" text-anchor="middle">期间新增</text></svg></div><div class="analytics-status-legend">${labels.map((label,i)=>`<button data-status="${i}"><i style="background:${analyticsColors[i]}"></i><span>${label}</span><b>${data.states[i].length}</b></button>`).join('')}</div>`;
  qsa<HTMLElement|SVGElement>('[data-status]').forEach(b=>{b.onclick=()=>analyticsSelect(labels[Number(b.dataset.status)],data.states[Number(b.dataset.status)]);if(b instanceof SVGElement)b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();b.dispatchEvent(new MouseEvent('click'));}};});
  const owners=[...new Set([...members.map(m=>m.id),...data.created.map(t=>t.ownerId)])];
  const ownerData=owners.map(id=>({id,groups:data.states.map(group=>group.filter(t=>t.ownerId===id))}));
  const peak=Math.max(1,...ownerData.map(o=>o.groups.reduce((n,g)=>n+g.length,0)));
  qs('#analyticsMembers')!.innerHTML=total?ownerData.map((o,i)=>`<div class="analytics-member-row"><span>${escapeHtml(memberName(o.id))}</span><div class="analytics-stack">${o.groups.map((g,k)=>g.length?`<button data-member-stat="${i}:${k}" style="width:${g.length/peak*100}%;background:${analyticsColors[k]}" aria-label="${escapeHtml(memberName(o.id))} ${labels[k]} ${g.length} 项" title="${labels[k]} ${g.length} 项">${g.length}</button>`:'').join('')}</div><b>${o.groups.reduce((n,g)=>n+g.length,0)}</b></div>`).join(''):'<div class="analytics-empty">所选期间暂无新增任务</div>';
  qsa<HTMLElement>('[data-member-stat]').forEach(b=>b.onclick=()=>{const [i,k]=b.dataset.memberStat!.split(':').map(Number),o=ownerData[i];analyticsSelect(`${memberName(o.id)} · ${labels[k]}`,o.groups[k]);});
  analyticsSelect('期间新增任务',data.created,false);
}
function bindAnalytics(){
  const form=qs<HTMLFormElement>('#analyticsRange')!,start=qs<HTMLInputElement>('#analyticsStart')!,end=qs<HTMLInputElement>('#analyticsEnd')!;
  const setActive=(key:string)=>qsa<HTMLElement>('[data-period]').forEach(b=>{b.classList.toggle('active',b.dataset.period===key);b.setAttribute('aria-pressed',String(b.dataset.period===key));});
  const preset=(key:string)=>{setActive(key);qs('#analyticsRangeError')!.textContent='';if(key==='custom'){start.focus();return;}end.value=localDay();const date=new Date(end.value+'T00:00:00Z');if(key==='month')date.setUTCDate(1);else date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);start.value=date.toISOString().slice(0,10);renderAnalytics();};
  qsa<HTMLElement>('[data-period]').forEach(b=>b.onclick=()=>preset(b.dataset.period!));
  for(const input of [start,end])input.oninput=()=>setActive('custom');
  form.onsubmit=e=>{e.preventDefault();if(start.value>end.value||Date.parse(end.value)-Date.parse(start.value)>365*86400000){qs('#analyticsRangeError')!.textContent='开始日期不得晚于结束日期，最多选择 366 天。';return;}qs('#analyticsRangeError')!.textContent='';renderAnalytics();};
  preset('month');
}
