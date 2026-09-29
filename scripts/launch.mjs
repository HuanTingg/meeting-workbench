import {spawn} from 'node:child_process';
import {createProductionApplication,loadEnvironment} from '../app/bootstrap.mjs';
import {createApplication} from '../app/server.mjs';
loadEnvironment();
const port=Number(process.env.PORT||8765),url=`http://127.0.0.1:${port}`;
function open(){console.log(`会议工作台：${url}\n关闭此窗口或按 Ctrl+C 停止服务。`);spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore'}).on('error',()=>console.log('请在浏览器打开上方地址。'));}
let existing=false;
try{const result=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});const data=await result.json();existing=data.ok===true&&data.mode==='local'&&data.version===1;}catch{}
if(existing){open();}else{
  const server=await createProductionApplication(createApplication);
  server.once('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已被其他服务占用，请先关闭占用 8765 的程序。':error.message);process.exitCode=1;});
  server.listen(port,process.env.MEETING_BIND_HOST||'127.0.0.1',open);
}
