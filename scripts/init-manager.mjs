import fs from 'node:fs';import path from 'node:path';import {randomBytes} from 'node:crypto';
import {loadEnvironment,root} from '../app/bootstrap.mjs';import {openMysqlStore} from '../app/mysql-store.mjs';import {hashPassword} from '../app/auth.mjs';
loadEnvironment();const store=await openMysqlStore(process.env.DATABASE_URL);
try{
 if(store.state.accounts?.length)throw Error('已经存在账号，不能重复初始化负责人');
 const member=store.state.members.find(m=>m.name===process.argv[2]);if(!member)throw Error('指定成员不存在');
 const username=process.argv[3];if(!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username||''))throw Error('登录账号格式无效');
 const password=randomBytes(18).toString('base64url');
 const output=path.join(root,'data','负责人初始登录信息.txt');
 fs.writeFileSync(output,`会议纪要负责人账号\n成员：${member.name}\n登录地址：http://127.0.0.1:8765/\n账号：${username}\n初始密码：${password}\n\n首次登录必须修改密码。修改后此初始密码失效，请删除本文件。\n`,{flag:'wx',mode:0o600});
 store.state.accounts=[{id:'account_'+randomBytes(16).toString('hex'),memberId:member.id,username,passwordHash:hashPassword(password),role:'manager',disabled:false,mustChangePassword:true,version:1}];
 await store.save(store.state);console.log('负责人账号已初始化；初始登录信息保存于 data/负责人初始登录信息.txt');
}finally{await store.close();}
