import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {openMysqlStore} from '../app/mysql-store.mjs';
import {readJSON,portNumber,assertPortFree,launch,waitReady,managedState,startManagedMysql,stopMysql,initializeWorkspace} from './native-lib.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const home=path.resolve(process.env.MEETING_NATIVE_HOME||root); // separate test instances only
const mode=process.argv[2]||'start';
if(!['setup','start'].includes(mode))throw Error('使用 native.mjs setup 或 start');
const tools=readJSON(path.join(home,'.runtime','native-tools.json'));
for(const key of ['node','python','mysqld'])if(!fs.existsSync(tools[key]||''))throw Error(`${key} 环境缺失，请重新运行部署命令。`);
fs.mkdirSync(path.join(home,'logs'),{recursive:true});
const envFile=path.join(home,'.env'),existingEnv=fs.existsSync(envFile);
if(existingEnv)process.loadEnvFile(envFile);
const port=portNumber(process.env.PORT,8765),asrPort=portNumber(process.env.FUNASR_PORT,10097),mysqlPort=portNumber(process.env.MYSQL_LOCAL_PORT,13306);
const dataDir=process.env.MEETING_DATA_DIR?path.resolve(home,process.env.MEETING_DATA_DIR):path.join(home,'data');
const children=[];let sqlState=null,sqlChild=null,stopping=false;
async function stop(code=0){
  if(stopping)return;stopping=true;
  // Only stop processes started by this command; an existing ASR service is not owned.
  for(const child of children.reverse()){
    if(child.exitCode!==null)continue;
    child.kill('SIGTERM');await Promise.race([once(child,'exit').catch(()=>{}),new Promise(r=>setTimeout(r,3000))]);
    if(child.exitCode===null)child.kill('SIGKILL');
  }
  if(sqlChild&&sqlChild.exitCode===null){
    const exited=once(sqlChild,'exit');
    try{await stopMysql(sqlState);await Promise.race([exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('MySQL shutdown timeout')),15000))]);}catch{sqlChild.kill();}
  }
  process.exit(code);
}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{console.log('\n正在停止本次启动的服务…');void stop();});
try{
  await assertPortFree(port);
  const managed=fs.existsSync(path.join(home,'.runtime','native-mysql','credentials.json'))||!existingEnv;
  if(managed){
    sqlState=managedState(home,mysqlPort);
    sqlChild=await startManagedMysql(home,tools.mysqld,sqlState);
    if(!existingEnv){
      fs.writeFileSync(envFile,`DATABASE_URL=${sqlState.url}\nPORT=${port}\nFUNASR_PORT=${asrPort}\nMYSQL_LOCAL_PORT=${mysqlPort}\nMEETING_BIND_HOST=127.0.0.1\n`,{flag:'wx',mode:0o600});
      process.loadEnvFile(envFile);
    }
    if(process.env.DATABASE_URL!==sqlState.url)throw Error('.env 与本项目 MySQL 凭据不一致，请恢复原配置，不会覆盖数据。');
    await initializeWorkspace(sqlState.url,dataDir,asrPort);
  }else{
    if(!process.env.DATABASE_URL)throw Error('已有 .env 缺少 DATABASE_URL，请恢复原连接配置。');
    console.log('保留现有 .env，检查原 MySQL 数据库和账号…');
    const store=await openMysqlStore(process.env.DATABASE_URL);await store.close();
  }
  // Mandatory health gate: no successful launch without actual speech models loaded.
  const asrHealth=async()=>{const response=await fetch(`http://127.0.0.1:${asrPort}/health`,{signal:AbortSignal.timeout(2000)});const health=await response.json();return response.ok&&health.model_loaded===true;};
  let speechReady=false;try{speechReady=await asrHealth();}catch{}
  if(!speechReady){
    await assertPortFree(asrPort);
    const child=launch(tools.python,[path.join(root,'scripts/run-funasr.py')],path.join(home,'logs','native-funasr.log'),{...process.env,FUNASR_PORT:String(asrPort),PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'});children.push(child);
    await waitReady(asrHealth,child,15*60000,'FunASR 模型');
  }
  const child=launch(tools.node,[path.join(root,'app/server.mjs')],path.join(home,'logs','native-web.log'),{...process.env,MEETING_DATA_DIR:dataDir,PORT:String(port)});children.push(child);
  await waitReady(async()=>{const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(2000)});const j=await r.json();return r.ok&&j.ok&&j.storage==='mysql';},child,30000,'网页');
  console.log(`\n部署已就绪：MySQL、FunASR 模型、网页全部通过检查。\n打开 http://127.0.0.1:${port}\n${managed?'初始管理员：admin；密码在 '+path.join(dataDir,'initial-admin.json')+'，首次登录修改。':'使用原有成员账号登录。'}\n保持此终端运行；按 Ctrl+C 停止本次启动的服务。`);
  for(const service of [...children,...(sqlChild?[sqlChild]:[])])service.once('exit',()=>{if(!stopping){console.error('服务意外退出，请检查 logs 并重新运行启动命令。');void stop(1);}});
  if(process.env.MEETING_DEPLOY_VERIFY==='1'){console.log('自动验证模式：健康检查通过，停止本次服务。');await stop();}
}catch(e){console.error('部署未完成：'+e.message);await stop(1);}
