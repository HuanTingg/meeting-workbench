import {randomBytes, scryptSync, timingSafeEqual, createHash} from 'node:crypto';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
export function hashPassword(password){
  if(typeof password!=='string'||password.length<8||password.length>128)fail('密码需为8–128个字符');
  const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex');
}
function verify(password,hash){try{const [salt,key]=hash.split(':');const actual=scryptSync(String(password),salt,64);return timingSafeEqual(actual,Buffer.from(key,'hex'));}catch{return false;}}
export function createAuth(db,save){
  db.accounts??=[];const sessions=new Map(),attempts=new Map();
  const publicAccount=a=>({id:a.id,memberId:a.memberId,username:a.username,role:a.role,disabled:!!a.disabled,mustChangePassword:!!a.mustChangePassword,name:db.members.find(m=>m.id===a.memberId)?.name||a.username});
  const cookie=(res,value)=>res.setHeader('Set-Cookie',`meeting_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${value?28800:0}`);
  function current(req){const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('meeting_session='))?.slice(16);if(!token)return null;const key=createHash('sha256').update(token).digest('hex'),session=sessions.get(key);if(!session)return null;const a=db.accounts.find(a=>a.id===session.accountId);if(session.expires<Date.now()||!a||a.disabled||session.version!==(a.version||0)){sessions.delete(key);return null;}return a;}
  function revoke(id){for(const [key,s] of sessions)if(s.accountId===id)sessions.delete(key);}
  async function login(body,req,res){
    const key=req.socket.remoteAddress||'local',previous=attempts.get(key);if(previous&&previous.until>Date.now()&&previous.count>=10)fail('登录失败次数过多，请15分钟后再试',429);
    const username=String(body.username||'').trim().toLowerCase();const a=db.accounts.find(a=>a.username===username);
    if(typeof body.password!=='string'||body.password.length>128||!a||a.disabled||!verify(body.password,a.passwordHash)){
      const item=previous&&previous.until>Date.now()?previous:{count:0,until:Date.now()+900000};item.count++;attempts.set(key,item);fail('账号或密码错误，或账号已停用',401);
    }
    attempts.delete(key);for(const [k,s] of sessions)if(s.expires<Date.now())sessions.delete(k);
    const token=randomBytes(32).toString('hex');sessions.set(createHash('sha256').update(token).digest('hex'),{accountId:a.id,version:a.version||0,expires:Date.now()+28800000});cookie(res,token);return publicAccount(a);
  }
  async function changePassword(a,b,res){if(!verify(b.currentPassword,a.passwordHash))fail('当前密码不正确');a.passwordHash=hashPassword(b.password);a.mustChangePassword=false;a.version=(a.version||0)+1;await save();revoke(a.id);cookie(res,'');}
  async function configure(memberId,b,actor){
    if(!db.members.some(m=>m.id===memberId))fail('成员不存在',404);
    const username=typeof b.username==='string'?b.username.trim().toLowerCase():'';
    if(!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username))fail('账号需为3–40位字母、数字、下划线、点或连字符');
    const old=db.accounts.find(a=>a.memberId===memberId);
    if(db.accounts.some(a=>a!==old&&a.username===username))fail('账号已被使用');
    if(!['manager','member'].includes(b.role))fail('请选择账号角色');
    if(old?.id===actor.id&&(b.disabled===true||b.role!=='manager'))fail('不能停用或降级当前负责人账号');
    if(old?.role==='manager'&&(b.role!=='manager'||b.disabled===true)&&!db.accounts.some(a=>a!==old&&a.role==='manager'&&!a.disabled))fail('至少保留一个启用的负责人账号');
    const passwordHash=b.password?hashPassword(b.password):old?.passwordHash;if(!passwordHash)fail('新账号需要设置初始密码');
    const a={...old,id:old?.id||'account_'+randomBytes(16).toString('hex'),memberId,username,role:b.role,disabled:b.disabled===true,passwordHash,mustChangePassword:b.password?true:old?.mustChangePassword||false,version:(old?.version||0)+1};
    if(old)Object.assign(old,a);else db.accounts.push(a);await save();revoke(a.id);return publicAccount(a);
  }
  return {current,login,changePassword,configure,publicAccount,revoke,logout(req,res){const a=current(req);if(a)revoke(a.id);cookie(res,'');}};
}
