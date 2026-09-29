import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {connectionOptions} from '../app/mysql-store.mjs';
test('database permits only loopback or explicitly configured container host',()=>{
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
    const script=fileURLToPath(new URL('../scripts/configure-docker.mjs',import.meta.url));
    execFileSync(process.execPath,[script],{cwd:dir});
    const file=path.join(dir,'.env.docker'),first=fs.readFileSync(file,'utf8');
    const secrets=[...first.matchAll(/^MYSQL(?:_ROOT)?_PASSWORD=([a-f0-9]{48})$/gm)];
    assert.equal(secrets.length,2);assert.notEqual(secrets[0][1],secrets[1][1]);
    execFileSync(process.execPath,[script],{cwd:dir});assert.equal(fs.readFileSync(file,'utf8'),first);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
