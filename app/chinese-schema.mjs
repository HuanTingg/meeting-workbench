import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {tables,tableNames,columnNames,DATABASE_NAME,createSchema} from './mysql-store.mjs';
const quote=v=>'`'+v.replaceAll('`','``')+'`';
export async function migrateChineseSchema(conn,{databaseName=DATABASE_NAME,backupDir}={}) {
  const lockName='meeting-'+createHash('sha256').update(databaseName).digest('hex').slice(0,48);
  const [[lock]]=await conn.query('SELECT GET_LOCK(?,0) AS acquired',[lockName]);
  if(lock.acquired!==1)throw Error('请先停止会议服务');
  try {
    const [list]=await conn.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[databaseName]);
    const names=new Set(list.map(r=>r.name));
    // The Feishu table did not exist in older workspaces; create it after the legacy rename.
    const existingTables=Object.fromEntries(Object.entries(tables).filter(([name])=>!['feishu_settings','accounts'].includes(name)||names.has(name)||names.has(tableNames[name])));
    for(const old of Object.keys(existingTables)) {
      if(names.has(old)&&names.has(tableNames[old]))throw Error('发现中英文同名业务表，停止迁移');
      if(!names.has(old)&&!names.has(tableNames[old]))throw Error('缺少业务表：'+tableNames[old]);
    }
    if(backupDir) {
      const backup={databaseName,createdAt:new Date().toISOString(),tables:{}};
      for(const old of Object.keys(existingTables)){const name=names.has(old)?old:tableNames[old];const [rows]=await conn.query('SELECT * FROM '+quote(name));const [ddl]=await conn.query('SHOW CREATE TABLE '+quote(name));backup.tables[name]={ddl:ddl[0]['Create Table'],rows};}
      fs.mkdirSync(backupDir,{recursive:true});fs.writeFileSync(path.join(backupDir,'mysql-before-chinese-'+Date.now()+'.json'),JSON.stringify(backup,null,2),{flag:'wx',mode:0o600});
    }
    // Each ALTER is atomic; introspection makes interrupted migrations resumable.
    for(const [old,columns] of Object.entries(existingTables)) {
      const name=names.has(old)?old:tableNames[old];
      const [fields]=await conn.query('SHOW COLUMNS FROM '+quote(name));const existing=new Set(fields.map(c=>c.Field));
      // MySQL cannot rename a source column while generated columns depend on it.
      const generated=Object.keys(columns).flatMap(c=>[c,columnNames[c]]).filter(c=>existing.has(c));
      if(generated.length)await conn.query('ALTER TABLE '+quote(name)+' '+generated.map(c=>'DROP COLUMN '+quote(c)).join(', '));
      const changes=['id','sort_order','payload','updated_at'].filter(c=>existing.has(c)).map(c=>'RENAME COLUMN '+quote(c)+' TO '+quote(columnNames[c]));
      if(changes.length)await conn.query('ALTER TABLE '+quote(name)+' '+changes.join(', '));
      const additions=Object.entries(columns).map(([c,field])=>'ADD COLUMN '+quote(columnNames[c])+` VARCHAR(${c==='base_url'?1000:255}) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(\`数据\`, '$.${field}'))) STORED`);
      if(additions.length)await conn.query('ALTER TABLE '+quote(name)+' '+additions.join(', '));
    }
    const renames=Object.keys(existingTables).filter(old=>names.has(old)).map(old=>quote(old)+' TO '+quote(tableNames[old]));
    if(renames.length)await conn.query('RENAME TABLE '+renames.join(', '));
    await conn.execute("UPDATE `系统元数据` SET `数据`=JSON_SET(`数据`,'$.schemaVersion',2) WHERE `编号`='workspace'");
    await createSchema(conn);
  }finally{await conn.query('SELECT RELEASE_LOCK(?)',[lockName]);}
}
