// Destructive to the test admin password. Use only an isolated, fresh smoke project.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const project=process.env.COMPOSE_TEST_PROJECT;
if(!project?.startsWith('meeting-smoke-'))throw Error('Use a fresh COMPOSE_TEST_PROJECT starting with meeting-smoke-');
const dc=(...args)=>execFileSync('docker',['compose','--env-file','.env.docker','-p',project,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const initial=JSON.parse(dc('exec','-T','web','cat','/app/data/initial-admin.json'));
const base='http://127.0.0.1:'+ (process.env.MEETING_HTTP_PORT||8765);
let cookie='';
async function call(route,method='GET',body){
  const r=await fetch(base+route,{method,headers:{Cookie:cookie,'X-Requested-With':'MeetingLocal'},body:body===undefined?undefined:JSON.stringify(body)});
  const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];
  assert.equal(r.ok,true,`HTTP ${r.status} at ${route}`);return r.json();
}
assert.equal((await call('/api/health')).storage,'mysql');
assert.match(await (await fetch(base)).text(),/html/i);
assert.equal((await fetch(base+'/api/todos')).status,401);
const first=await call('/api/auth/login','POST',initial);
assert.equal(first.user.mustChangePassword,true);
const password=randomBytes(24).toString('base64url');
await call('/api/auth/password','POST',{currentPassword:initial.password,password});
await call('/api/auth/login','POST',{username:initial.username,password});
const {todo}=await call('/api/todos','POST',{title:'Compose persistence verification',ownerId:first.user.memberId});
dc('restart','web');
let ready=false;
for(let i=0;i<40;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
assert.equal(ready,true,'Web did not restart');
await call('/api/auth/login','POST',{username:initial.username,password});
assert.ok((await call('/api/todos')).todos.some(t=>t.id===todo.id));
assert.deepEqual(JSON.parse(dc('exec','-T','web','cat','/app/data/initial-admin.json')),initial);
console.log('Compose verified: MySQL bootstrap, login, forced password change, task persistence and restart without password reset.');
