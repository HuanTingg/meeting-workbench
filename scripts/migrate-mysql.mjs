import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import mysql from 'mysql2/promise';
import {loadEnvironment,root} from '../app/bootstrap.mjs';
import {DATABASE_NAME,connectionOptions,openMysqlStore,serializeState,tableNames} from '../app/mysql-store.mjs';
loadEnvironment();
const url=process.env.DATABASE_URL||process.env.MYSQL_ADMIN_URL;
if(!url)throw Error('请在 .env 设置 DATABASE_URL 或 MYSQL_ADMIN_URL');
// Refuse a live migration: old JSON writer must stop first.
try{const r=await fetch('http://127.0.0.1:8765/api/health',{signal:AbortSignal.timeout(1000)});if(r.ok)throw Error('服务正在运行，请先关闭会议工作台再迁移');}catch(e){if(e.message.includes('正在运行'))throw e;}
const admin=await mysql.createConnection(connectionOptions(process.env.MYSQL_ADMIN_URL||url));
try{await admin.query('CREATE DATABASE IF NOT EXISTS `会议纪要管理` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');}finally{await admin.end();}
const dataDir=process.env.MEETING_DATA_DIR||path.join(root,'data');
const source=path.join(dataDir,'workspace.json');
const seed=fs.existsSync(source)?JSON.parse(fs.readFileSync(source,'utf8')):{version:1,settings:{},members:[],meetings:[],todos:[],notifications:[]};
if(fs.existsSync(source)){const backups=path.join(dataDir,'backups');fs.mkdirSync(backups,{recursive:true});fs.copyFileSync(source,path.join(backups,'workspace-before-mysql-'+Date.now()+'.json'),fs.constants.COPYFILE_EXCL);}
const normalized=db=>Object.fromEntries(Object.entries(serializeState(db)).map(([t,rows])=>[t,rows.map(r=>({...r,json:JSON.parse(r.json)}))]));
let store=await openMysqlStore(url,{initialize:true,seed});
const expected=normalized(store.state);await store.close();store=await openMysqlStore(url);
try{if(!isDeepStrictEqual(normalized(store.state),expected))throw Error('迁移后回读校验失败');console.log('数据库回读校验通过：'+DATABASE_NAME);for(const [table,rows] of Object.entries(expected))console.log(tableNames[table]+': '+rows.length+' 行');}finally{await store.close();}
