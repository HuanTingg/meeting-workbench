import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {connectionOptions} from '../app/mysql-store.mjs';
import {managedState} from '../scripts/native-lib.mjs';
test('database permits only loopback or explicitly configured host',()=>{
  const previous=process.env.MYSQL_ALLOWED_HOST;
  try{
    delete process.env.MYSQL_ALLOWED_HOST;
    assert.equal(connectionOptions('mysql://u:p@localhost/').host,'localhost');
    assert.throws(()=>connectionOptions('mysql://u:p@db/'));
    process.env.MYSQL_ALLOWED_HOST='db';
    assert.equal(connectionOptions('mysql://u:p%40ss@db/').password,'p@ss');
    assert.throws(()=>connectionOptions('mysql://u:p@other/'));
  }finally{if(previous===undefined)delete process.env.MYSQL_ALLOWED_HOST;else process.env.MYSQL_ALLOWED_HOST=previous;}
});
test('deployment configuration generates unique secrets and preserves existing config',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-deploy-'));
  try{
    const first=managedState(dir,13306);
    assert.match(first.rootPassword,/^[a-f0-9]{48}$/);
    assert.match(first.appPassword,/^[a-f0-9]{48}$/);
    assert.notEqual(first.rootPassword,first.appPassword);
    assert.deepEqual(managedState(dir,13306),first);
    assert.throws(()=>managedState(dir,13307),/端口与已有部署不一致/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
