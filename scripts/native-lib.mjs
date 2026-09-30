import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import mysql from 'mysql2/promise';
import {openMysqlStore} from '../app/mysql-store.mjs';
import {hashPassword} from '../app/auth.mjs';

export const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
export function portNumber(value,fallback){const n=Number(value||fallback);if(!Number.isInteger(n)||n<1024||n>65535)throw Error('端口必须为 1024–65535');return n;}
export async function assertPortFree(port){
  await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(Error(`端口 ${port} 已被占用，请先停止同一项目的旧服务，或修改 .env 中的端口。`)));server.listen(port,'127.0.0.1',()=>server.close(resolve));});
}
export function runProcess(exe,args,options={}){
  return new Promise((resolve,reject)=>{const child=spawn(exe,args,{windowsHide:true,stdio:'inherit',...options});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`程序退出码 ${code}：${path.basename(exe)}（请查看上方输出）`)));});
}
export function launch(exe,args,log,env=process.env){
  const fd=fs.openSync(log,'a');const child=spawn(exe,args,{windowsHide:true,stdio:['ignore',fd,fd],env});fs.closeSync(fd);
  child.launchError=null;child.on('error',e=>{child.launchError=e;});return child;
}
export async function waitReady(check,child,timeout,label){
  const started=Date.now();let last=started;
  while(Date.now()-started<timeout){
    if(child?.launchError||child?.exitCode!==null&&child?.exitCode!==undefined)throw Error(`${label} 启动失败，请检查 logs 下对应日志。`);
    try{if(await check())return;}catch{}
    if(Date.now()-last>15000){console.log(`${label} 正在启动，已等待 ${Math.round((Date.now()-started)/1000)} 秒…`);last=Date.now();}
    await new Promise(r=>setTimeout(r,1000));
  }
  throw Error(`${label} 未在规定时间就绪，请检查 logs 下对应日志并重新执行部署。`);
}
export function managedState(home,port){
  const folder=path.join(home,'.runtime','native-mysql');fs.mkdirSync(folder,{recursive:true});
  const file=path.join(folder,'credentials.json');
  if(!fs.existsSync(file)){
    if(fs.existsSync(path.join(folder,'data')))throw Error('MySQL 数据目录存在但凭据缺失，禁止重新初始化；请恢复原凭据备份。');
    fs.writeFileSync(file,JSON.stringify({port,rootPassword:randomBytes(24).toString('hex'),appPassword:randomBytes(24).toString('hex')},null,2),{flag:'wx',mode:0o600});
  }
  const state=readJSON(file);if(state.port!==port)throw Error('MySQL 端口与已有部署不一致，请恢复原 MYSQL_LOCAL_PORT。');
  if(!/^[a-f0-9]{48}$/.test(state.rootPassword)||!/^[a-f0-9]{48}$/.test(state.appPassword))throw Error('MySQL 凭据文件无效。');
  return {...state,folder,url:`mysql://meeting:${state.appPassword}@127.0.0.1:${port}/`};
}
export async function startManagedMysql(home,exe,state){
  await assertPortFree(state.port);
  let mysqlHome=home;
  if(process.platform==='win32'&&/[^\x00-\x7f]/.test(home)){
    // MySQL on Windows cannot reliably open Unicode option paths. A junction
    // keeps all data in the project while providing an ASCII access path.
    const alias=path.join(os.tmpdir(),'meeting-native-'+createHash('sha256').update(home).digest('hex').slice(0,12));
    if(/[^\x00-\x7f]/.test(alias))throw Error('MySQL 需要 ASCII 临时路径，请将 TEMP 和 TMP 设置到可写的英文目录后重试。');
    if(!fs.existsSync(alias))fs.symlinkSync(home,alias,'junction');
    if(fs.realpathSync(alias)!==fs.realpathSync(home))throw Error('MySQL 路径别名已被其他目录占用。');
    mysqlHome=alias;
  }
  const mapped=p=>p.startsWith(home+path.sep)?path.join(mysqlHome,path.relative(home,p)):p;
  const datadir=mapped(path.join(state.folder,'data')),basedir=mapped(path.dirname(path.dirname(exe)));
  const log=mapped(path.join(home,'logs','native-mysql.log'));
  const base=['--no-defaults',`--basedir=${basedir}`,`--datadir=${datadir}`];
  if(!fs.existsSync(path.join(datadir,'mysql'))){
    if(fs.existsSync(datadir)&&fs.readdirSync(datadir).length)throw Error('MySQL 初始化未完整结束；请检查日志，不会覆盖已有目录。');
    fs.mkdirSync(datadir,{recursive:true});
    console.log('正在初始化独立 MySQL 数据目录…');
    await runProcess(exe,[...base,'--initialize-insecure',`--log-error=${log}`]);
  }
  const initFile=mapped(path.join(state.folder,'bootstrap.sql'));
  const initialized=path.join(state.folder,'secured');
  if(!fs.existsSync(initialized))fs.writeFileSync(initFile,`SET NAMES utf8mb4;\nALTER USER 'root'@'localhost' IDENTIFIED BY '${state.rootPassword}';\nCREATE DATABASE IF NOT EXISTS \`会议纪要管理\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\nCREATE USER IF NOT EXISTS 'meeting'@'localhost' IDENTIFIED BY '${state.appPassword}';\nGRANT ALL ON \`会议纪要管理\`.* TO 'meeting'@'localhost';\n`,{mode:0o600});
  const socket=path.join(os.tmpdir(),'meeting-'+createHash('sha256').update(home).digest('hex').slice(0,12)+'.sock');
  const args=[...base,`--port=${state.port}`,'--bind-address=127.0.0.1','--mysqlx=OFF','--character-set-server=utf8mb4','--collation-server=utf8mb4_unicode_ci',`--log-error=${log}`,`--socket=${socket}`,`--pid-file=${mapped(path.join(state.folder,'mysql.pid'))}`];
  if(!fs.existsSync(initialized))args.push(`--init-file=${initFile}`);
  // Windows MySQL parses non-ASCII command-line option values incorrectly.
  // Supply UTF-8 paths in an option file rather than the process argument list.
  const optionFile=path.join(os.tmpdir(),'meeting-'+createHash('sha256').update(home).digest('hex').slice(0,12)+'.cnf');
  fs.writeFileSync(optionFile,'[mysqld]\n'+args.filter(a=>a!=='--no-defaults').map(a=>{
    const [key,...value]=a.slice(2).split('=');
    return key+'="'+value.join('=').replaceAll('\\','/').replaceAll('"','\\"')+'"';
  }).join('\n')+'\n',{mode:0o600});
  const child=launch(exe,[`--defaults-file=${optionFile}`],log);
  try{
    await waitReady(async()=>{const conn=await mysql.createConnection({host:'127.0.0.1',port:state.port,user:'meeting',password:state.appPassword,database:'会议纪要管理',charset:'utf8mb4',connectTimeout:1000});await conn.query('SELECT 1');await conn.end();return true;},child,120000,'MySQL');
    fs.writeFileSync(initialized,'Initialized. Do not remove.\n',{mode:0o600});fs.rmSync(initFile,{force:true});return child;
  }catch(e){child.kill();throw e;}
}
export async function stopMysql(state){
  if(!state)return;
  const conn=await mysql.createConnection({host:'127.0.0.1',port:state.port,user:'root',password:state.rootPassword,connectTimeout:3000});
  try{await conn.query('SHUTDOWN');}finally{conn.destroy();}
}
export async function initializeWorkspace(url,dataDir,asrPort){
  fs.mkdirSync(dataDir,{recursive:true});
  const file=path.join(dataDir,'initial-admin.json');
  if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({username:'admin',password:randomBytes(24).toString('base64url'),memberId:'member_'+randomBytes(16).toString('hex'),accountId:'account_'+randomBytes(16).toString('hex')},null,2),{flag:'wx',mode:0o600});
  const initial=readJSON(file);
  const seed={version:1,settings:{aiEnabled:false,transcriptionUrl:`http://127.0.0.1:${asrPort}/v1`},members:[{id:initial.memberId,name:'管理员',department:''}],accounts:[{id:initial.accountId,memberId:initial.memberId,username:initial.username,passwordHash:hashPassword(initial.password),role:'manager',disabled:false,mustChangePassword:true,version:1}],meetings:[],todos:[],notifications:[],dingtalk:{},feishu:{}};
  const store=await openMysqlStore(url,{initialize:true,seed});await store.close();
}
