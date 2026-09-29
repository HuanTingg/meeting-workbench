import {hashPassword} from '../app/auth.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openMysqlStore,connectionOptions,tables,tableNames,columnNames} from '../app/mysql-store.mjs';
import {migrateChineseSchema} from '../app/chinese-schema.mjs';
import {createApplication} from '../app/server.mjs';

test('MySQL: migration, API persistence, single writer, transaction rollback and restart',{skip:!process.env.MYSQL_TEST_ADMIN_URL},async()=>{
  const url=process.env.MYSQL_TEST_ADMIN_URL,admin=await mysql.createConnection(connectionOptions(url));
  const databaseName='meeting_test_'+randomBytes(6).toString('hex');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-mysql-'));
  let store,server;
  const seed={accounts:[{id:"account_test",memberId:"member_a",username:"admin",role:"manager",passwordHash:hashPassword("Test-password-123")}],version:1,feishu:{},settings:{aiEnabled:false,apiKey:'private',baseUrl:'',model:'',transcriptionKey:'asr-private',transcriptionUrl:''},members:[{id:'member_a',name:'测试成员',department:'产品',dingtalkUserId:'uid-a'}],todos:[],meetings:[{id:'meeting_a',title:'迁移会议',status:'review',transcript:'原文',speakers:[{label:'甲',assigneeId:'member_a'}],tasks:[{id:'task_a',title:'确认',status:'draft',assigneeId:'member_a'}],transcriptSegments:[{start:0,end:1,text:'原文'}]}],dingtalk:{webhook:'private-hook',groupEnabled:false,personalEnabled:false},notifications:[{id:'notice_a',key:'dedup',status:'unknown',isTest:true,content:'测试',attempts:1}]};
  try {
    await admin.query('CREATE DATABASE `'+databaseName+'` CHARACTER SET utf8mb4');
    store=await openMysqlStore(url,{initialize:true,seed,databaseName});await store.close();
    // Recreate the former English identifiers to exercise the real upgrade path.
    await admin.query('USE `'+databaseName+'`');
    for(const [old,columns] of Object.entries(tables)) {
      await admin.query('RENAME TABLE `'+tableNames[old]+'` TO `'+old+'`');
      if(Object.keys(columns).length)await admin.query('ALTER TABLE `'+old+'` '+Object.keys(columns).map(c=>'DROP COLUMN `'+columnNames[c]+'`').join(', '));
      const changes=['id','sort_order','payload','updated_at'].map(c=>'RENAME COLUMN `'+columnNames[c]+'` TO `'+c+'`');
      await admin.query('ALTER TABLE `'+old+'` '+changes.join(', '));
      if(Object.keys(columns).length)await admin.query('ALTER TABLE `'+old+'` '+Object.entries(columns).map(([c,f])=>`ADD COLUMN \`${c}\` VARCHAR(${c==='base_url'?1000:255}) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(payload,'$.${f}'))) STORED`).join(', '));
    }
    await admin.query("UPDATE app_metadata SET payload=JSON_SET(payload,'$.schemaVersion',1)");
    await migrateChineseSchema(admin,{databaseName,backupDir:path.join(dir,'backups')});
    await migrateChineseSchema(admin,{databaseName});
    const [fields]=await admin.query('SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=?',[databaseName]);
    assert.ok(fields.every(f=>/^[\u4e00-\u9fff]+$/.test(f.TABLE_NAME)&&/^[\u4e00-\u9fff]+$/.test(f.COLUMN_NAME)));
    store=await openMysqlStore(url,{databaseName});assert.deepEqual(store.state,seed);
    await assert.rejects(openMysqlStore(url,{databaseName}),/已有会议/);
    server=createApplication({store,dataDir:dir,fetchImpl:async()=>{throw Error('No external requests allowed');}});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'X-Requested-With':'MeetingLocal'},body:JSON.stringify({username:'admin',password:'Test-password-123'})});const cookie=login.headers.get('set-cookie').split(';')[0];
    const request=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'MeetingLocal',Cookie:cookie},body:JSON.stringify(body)});assert.equal(r.status,201);return r.json();};
    assert.equal((await (await fetch(base+'/api/health')).json()).storage,'mysql');
    const [a,b]=await Promise.all([request('/api/members',{name:'并发甲'}),request('/api/members',{name:'并发乙'})]);
    await request('/api/todos',{title:'持久化待办',ownerId:a.member.id});
    const completed=await fetch(base+'/api/todos/'+store.state.todos[0].id,{method:'PATCH',headers:{Cookie:cookie,'X-Requested-With':'MeetingLocal'},body:JSON.stringify({done:true,note:'MySQL完成记录',attachment:{name:'proof.txt',base64:'cHJvb2Y='}})});assert.equal(completed.status,200);
    assert.ok(!fs.existsSync(path.join(dir,'workspace.json')));
    const publicSettings=await (await fetch(base+'/api/settings',{headers:{Cookie:cookie}})).json();assert.equal(publicSettings.apiKey,undefined);assert.equal(publicSettings.hasKey,true);
    await new Promise(r=>server.close(r));server=null;await store.close();
    store=await openMysqlStore(url,{databaseName});assert.equal(store.state.members.length,3);assert.equal(store.state.todos.length,1);assert.equal(store.state.todos[0].completions[0].note,'MySQL完成记录');assert.equal(store.state.todos[0].completions[0].attachment.name,'proof.txt');assert.equal(store.state.accounts[0].username,'admin');assert.equal(store.state.members.find(m=>m.id===b.member.id).name,'并发乙');
    const valid=structuredClone(store.state);const broken=structuredClone(valid);broken.settings.model='must-rollback';broken.todos.push({id:'x'.repeat(181),title:'invalid'});
    await assert.rejects(store.save(broken),/数据库写入失败/);assert.throws(()=>store.assertHealthy(),/数据库写入失败/);
    await store.close();store=await openMysqlStore(url,{databaseName});assert.deepEqual(store.state,valid);
  }finally{
    if(server)await new Promise(r=>server.close(r));if(store)await store.close();
    if(!/^meeting_test_[a-f0-9]{12}$/.test(databaseName))throw Error('Unsafe test database');
    await admin.query('DROP DATABASE `'+databaseName+'`');await admin.end();fs.rmSync(dir,{recursive:true,force:true});
  }
});
