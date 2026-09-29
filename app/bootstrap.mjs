import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openMysqlStore} from './mysql-store.mjs';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function loadEnvironment(){const file=path.join(root,'.env');if(fs.existsSync(file))process.loadEnvFile(file);}
export async function createProductionApplication(createApplication){
  loadEnvironment();
  if(!process.env.DATABASE_URL)throw Error('缺少本地 MySQL 配置，请先配置 .env 并执行 npm.cmd run db:migrate');
  const store=await openMysqlStore(process.env.DATABASE_URL);
  try{return createApplication({store});}catch(e){await store.close();throw e;}
}
