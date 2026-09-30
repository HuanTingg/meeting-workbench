import mysql from 'mysql2/promise';
import {createHash} from 'node:crypto';

export const DATABASE_NAME = '会议纪要管理';
// Separate rows for each entity and each configuration; generated columns support inspection/search.
export const tables = {
  app_metadata: {},
  accounts: {username:'username',member_id:'memberId',role:'role'},
  ai_settings: {model:'model'},
  transcription_settings: {base_url:'transcriptionUrl'},
  feishu_settings: {group_name:'groupName',app_id:'appId',chat_id:'chatId'},
  dingtalk_settings: {group_name:'groupName',agent_id:'agentId'},
  members: {name:'name',department:'department',dingtalk_user_id:'dingtalkUserId'},
  meetings: {title:'title',status:'status',meeting_date:'meetingDate'},
  meeting_speakers: {meeting_id:'meetingId',assignee_id:'assigneeId'},
  meeting_tasks: {meeting_id:'meetingId',assignee_id:'assigneeId',status:'status'},
  transcript_segments: {meeting_id:'meetingId'},
  todos: {owner_id:'ownerId',meeting_id:'meetingId',title:'title'},
  notifications: {meeting_id:'meetingId',owner_id:'ownerId',status:'status',channel:'channel'},
};
export const tableNames = {accounts:'成员账号',feishu_settings:'飞书接入配置',app_metadata:'系统元数据',ai_settings:'智能模型配置',transcription_settings:'录音转写配置',dingtalk_settings:'钉钉接入配置',members:'成员信息',meetings:'会议记录',meeting_speakers:'会议发言人',meeting_tasks:'会议任务',transcript_segments:'转写片段',todos:'待办事项',notifications:'通知记录'};
export const columnNames = {username:'登录账号',member_id:'成员编号',role:'账号角色',app_id:'飞书应用编号',chat_id:'飞书群编号',id:'编号',sort_order:'排序',payload:'数据',updated_at:'更新时间',model:'模型名称',base_url:'服务地址',group_name:'群名称',agent_id:'应用编号',name:'姓名',department:'部门',dingtalk_user_id:'钉钉用户编号',title:'标题',status:'状态',meeting_date:'会议日期',meeting_id:'会议编号',assignee_id:'分配成员编号',owner_id:'负责人编号',channel:'通知渠道'};
const qi = v => '`' + v.replaceAll('`','``') + '`';
export function connectionOptions(value) {
  const u=new URL(value);
  const allowed=['127.0.0.1','localhost','[::1]',process.env.MYSQL_ALLOWED_HOST].filter(Boolean);
  if(u.protocol!=='mysql:' || !allowed.includes(u.hostname))throw Error('数据库地址未获允许；非本机数据库需明确设置 MYSQL_ALLOWED_HOST');
  return {host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),charset:'utf8mb4',connectTimeout:10000};
}
export async function createSchema(connection) {
  const [legacy]=await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_metadata'");
  if(legacy.length)throw Error('检测到英文旧表，请先运行 npm.cmd run db:chinese');
  for(const [table,columns] of Object.entries(tables)) {
    const generated=Object.entries(columns).map(([column,field])=>`, ${qi(columnNames[column])} VARCHAR(${column==='base_url'?1000:255}) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(\`数据\`, '$.${field}'))) STORED`).join('');
    await connection.query(`CREATE TABLE IF NOT EXISTS ${qi(tableNames[table])} (编号 VARCHAR(180) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, 排序 INT NOT NULL DEFAULT 0, 数据 JSON NOT NULL, 更新时间 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)${generated}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  }
}
export function serializeState(db) {
  const rows=Object.fromEntries(Object.keys(tables).map(t=>[t,[]]));
  const add=(table,id,data,order=rows[table].length)=>rows[table].push({id,order,json:JSON.stringify(data)});
  const {transcriptionUrl='',transcriptionKey='',...ai}=db.settings||{};
  add('ai_settings','default',ai);add('transcription_settings','default',{transcriptionUrl,transcriptionKey});add('dingtalk_settings','default',db.dingtalk||{});
  add('feishu_settings','default',db.feishu||{});
  add('app_metadata','workspace',{version:db.version||1,schemaVersion:2});
  for(const table of ['members','todos','notifications','accounts'])for(const row of db[table]||[])add(table,row.id,row);
  for(const m of db.meetings||[]) {
    const {speakers=[],tasks=[],transcriptSegments=[],...meeting}=m;add('meetings',m.id,meeting);
    for(const [table,children] of [['meeting_speakers',speakers],['meeting_tasks',tasks],['transcript_segments',transcriptSegments]])children.forEach((row,i)=>add(table,m.id+':'+i,{...row,meetingId:m.id},i));
  }
  return rows;
}
function restore(rows) {
  const cfg=t=>rows[t][0]?.data||{};
  const children=(table,id)=>rows[table].filter(r=>r.data.meetingId===id).map(({data})=>{const {meetingId,...child}=data;return child;});
  return {accounts:rows.accounts.map(r=>r.data),version:cfg('app_metadata').version||1,settings:{...cfg('ai_settings'),...cfg('transcription_settings')},dingtalk:cfg('dingtalk_settings'),feishu:cfg('feishu_settings'),members:rows.members.map(r=>r.data),todos:rows.todos.map(r=>r.data),notifications:rows.notifications.map(r=>r.data),meetings:rows.meetings.map(({data:m})=>({...m,speakers:children('meeting_speakers',m.id),tasks:children('meeting_tasks',m.id),transcriptSegments:children('transcript_segments',m.id)}))};
}
export async function openMysqlStore(url,{initialize=false,seed,databaseName=DATABASE_NAME}={}) {
  const conn=await mysql.createConnection({...connectionOptions(url),database:databaseName});
  conn.on('error',()=>{});
  let fault=null,tail=Promise.resolve(),closed=false;
  const assertHealthy=()=>{if(fault||closed)throw Object.assign(Error('数据库写入失败或连接已关闭，请检查 MySQL 并重启服务；本次操作未确认保存。'),{status:503});};
  try {
    const lockName='meeting-'+createHash('sha256').update(databaseName).digest('hex').slice(0,48);
    const [[lock]]=await conn.query('SELECT GET_LOCK(?,0) AS acquired',[lockName]);
    if(lock.acquired!==1)throw Error('已有会议服务或迁移程序连接此数据库，请先关闭它');
    await createSchema(conn);
    const existing={};let previous={};
    for(const table of Object.keys(tables)) {
      const [rows]=await conn.query(`SELECT 编号 AS id,排序 AS sort_order,数据 AS payload FROM ${qi(tableNames[table])} ORDER BY 排序,编号`);
      existing[table]=rows.map(r=>({id:r.id,order:r.sort_order,data:typeof r.payload==='string'?JSON.parse(r.payload):r.payload}));
      previous[table]=new Map(existing[table].map(r=>[r.id,{order:r.order,json:JSON.stringify(r.data)}]));
    }
    const initialized=existing.app_metadata.some(r=>r.id==='workspace');
    if(!initialized && !initialize)throw Error('数据库尚未迁移，请先运行 npm.cmd run db:migrate');
    if(!initialized && Object.values(existing).some(r=>r.length))throw Error('数据库存在未识别的数据，已停止迁移');
    if(initialized && existing.app_metadata.find(r=>r.id==='workspace').data.schemaVersion!==2)throw Error('数据库版本不兼容');
    const state=initialized?restore(existing):seed;
    if(!state)throw Error('首次迁移缺少源数据');
    const save=db=>{
      assertHealthy();const snapshot=serializeState(db);
      const operation=tail.then(async()=>{
        assertHealthy();
        try {
          await conn.beginTransaction();
          for(const [table,rows] of Object.entries(snapshot)) {
            const ids=new Set(rows.map(r=>r.id));
            for(const id of previous[table].keys())if(!ids.has(id))await conn.execute(`DELETE FROM ${qi(tableNames[table])} WHERE 编号=?`,[id]);
            for(const row of rows){const old=previous[table].get(row.id);if(old?.json===row.json&&old?.order===row.order)continue;await conn.execute(`INSERT INTO ${qi(tableNames[table])} (编号,排序,数据) VALUES (?,?,?) ON DUPLICATE KEY UPDATE 排序=VALUES(排序),数据=VALUES(数据)`,[row.id,row.order,row.json]);}
          }
          await conn.commit();
          previous=Object.fromEntries(Object.entries(snapshot).map(([t,rows])=>[t,new Map(rows.map(r=>[r.id,r]))]));
        }catch(e){try{await conn.rollback();}catch{}fault=e;assertHealthy();}
      });
      tail=operation.catch(()=>{});return operation;
    };
    if(!initialized)await save(state);
    let closing;
    return {state,save,assertHealthy,kind:'mysql',close(){return closing??=(async()=>{await tail;closed=true;await conn.end();})();}};
  }catch(e){await conn.end();throw e;}
}
