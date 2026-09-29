import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {openMysqlStore} from '../app/mysql-store.mjs';
import {hashPassword} from '../app/auth.mjs';
import {createApplication} from '../app/server.mjs';

const password=process.env.MYSQL_PASSWORD;
if(!password)throw Error('缺少 MYSQL_PASSWORD，请先生成 .env.docker');
const dir=process.env.MEETING_DATA_DIR||'/app/data';
fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'initial-admin.json');
// Persist candidate credentials before the first transaction so interrupted starts can retry.
if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({username:'admin',password:randomBytes(24).toString('base64url'),memberId:'member_'+randomBytes(16).toString('hex'),accountId:'account_'+randomBytes(16).toString('hex')},null,2),{flag:'wx',mode:0o600});
const initial=JSON.parse(fs.readFileSync(file,'utf8'));
const seed={version:1,settings:{aiEnabled:false,transcriptionUrl:'http://funasr:10097/v1'},members:[{id:initial.memberId,name:process.env.INITIAL_ADMIN_NAME||'管理员',department:''}],accounts:[{id:initial.accountId,memberId:initial.memberId,username:initial.username,passwordHash:hashPassword(initial.password),role:'manager',disabled:false,mustChangePassword:true,version:1}],meetings:[],todos:[],notifications:[],dingtalk:{},feishu:{}};
const store=await openMysqlStore(`mysql://meeting:${encodeURIComponent(password)}@db:3306/`,{initialize:true,seed});
// initialize:true only seeds an empty database; existing users/settings are never reset.
const application=createApplication({store,dataDir:dir});
application.listen(8765,'0.0.0.0',()=>console.log('会议工作台已启动；首次管理员凭据位于 /app/data/initial-admin.json，请登录后修改密码。'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>application.close(()=>{void store.close().then(()=>process.exit(0));}));
