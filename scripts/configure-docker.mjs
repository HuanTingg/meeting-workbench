import fs from 'node:fs';
import {randomBytes} from 'node:crypto';
const file='.env.docker';
if(fs.existsSync(file)){
  console.log('.env.docker 已存在，保留现有配置和密码。');
}else{
  fs.writeFileSync(file,`# Generated locally. Do not commit or regenerate for an existing database.\nMYSQL_PASSWORD=${randomBytes(24).toString('hex')}\nMYSQL_ROOT_PASSWORD=${randomBytes(24).toString('hex')}\nMEETING_LISTEN_IP=127.0.0.1\nMEETING_HTTP_PORT=8765\nMEETING_LAN_HOST=localhost\nINITIAL_ADMIN_NAME=管理员\n`,{flag:'wx',mode:0o600});
  console.log('已生成 .env.docker；数据库密码不会显示在日志中。');
}
