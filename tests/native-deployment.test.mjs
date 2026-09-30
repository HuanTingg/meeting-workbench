import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {once} from 'node:events';
import {managedState,startManagedMysql,stopMysql,initializeWorkspace,readJSON} from '../scripts/native-lib.mjs';
import {openMysqlStore} from '../app/mysql-store.mjs';
import {createApplication} from '../app/server.mjs';

test('Native MySQL: bootstrap, forced password change, API task persistence, full restart',{skip:!process.env.MYSQLD_TEST_PATH,timeout:180000},async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-native-'));
  fs.mkdirSync(path.join(home,'logs'));
  const state=managedState(home,Number(process.env.MYSQL_TEST_PORT||13316));
  const dataDir=path.join(home,'data');let sql,server,store;
  const shutdown=async()=>{if(server){await new Promise(r=>server.close(r));server=null;}if(store){await store.close();store=null;}if(sql&&sql.exitCode===null){const exited=once(sql,'exit');await stopMysql(state);await exited;}sql=null;};
  try{
    sql=await startManagedMysql(home,process.env.MYSQLD_TEST_PATH,state);
    await initializeWorkspace(state.url,dataDir,10097);
    const initial=readJSON(path.join(dataDir,'initial-admin.json'));
    store=await openMysqlStore(state.url);
    server=createApplication({store,dataDir,fetchImpl:async()=>{throw Error('External notifications forbidden in verification');}});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+server.address().port;let cookie='';
    const call=async(route,body)=>{const response=await fetch(base+route,{method:body?'POST':'GET',headers:{'X-Requested-With':'MeetingLocal',Cookie:cookie},body:body?JSON.stringify(body):undefined});const c=response.headers.get('set-cookie');if(c)cookie=c.split(';')[0];assert.ok(response.ok,`${route}: ${response.status}`);return response.json();};
    assert.equal((await call('/api/health')).storage,'mysql');
    assert.equal((await fetch(base+'/api/todos')).status,401);
    const first=await call('/api/auth/login',initial);assert.equal(first.user.mustChangePassword,true);
    const password='Native-test-password-321!';
    await call('/api/auth/password',{currentPassword:initial.password,password});
    await call('/api/auth/login',{username:'admin',password});
    const {todo}=await call('/api/todos',{title:'原生部署持久化验证',ownerId:first.user.memberId});
    await shutdown();
    sql=await startManagedMysql(home,process.env.MYSQLD_TEST_PATH,state);
    await initializeWorkspace(state.url,dataDir,10097);
    store=await openMysqlStore(state.url);
    assert.ok(store.state.todos.some(t=>t.id===todo.id));
    assert.equal(store.state.accounts[0].mustChangePassword,false);
    assert.deepEqual(readJSON(path.join(dataDir,'initial-admin.json')),initial);
    assert.equal(store.state.settings.transcriptionUrl,'http://127.0.0.1:10097/v1');
  }finally{await shutdown();if(path.basename(home).startsWith('meeting-native-'))fs.rmSync(home,{recursive:true,force:true});}
});
