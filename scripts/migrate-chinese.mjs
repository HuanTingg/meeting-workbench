import mysql from 'mysql2/promise';
import path from 'node:path';
import {loadEnvironment,root} from '../app/bootstrap.mjs';
import {connectionOptions,DATABASE_NAME} from '../app/mysql-store.mjs';
import {migrateChineseSchema} from '../app/chinese-schema.mjs';
loadEnvironment();
const conn=await mysql.createConnection({...connectionOptions(process.env.MYSQL_ADMIN_URL||process.env.DATABASE_URL),database:DATABASE_NAME});
try{await migrateChineseSchema(conn,{backupDir:path.join(root,'data','backups')});console.log('表名及字段名中文迁移完成');}finally{await conn.end();}
