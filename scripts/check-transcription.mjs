import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createApplication} from '../app/server.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sample=path.join(root,'.runtime/models/models/iic/speech_seaco_paraformer_large_asr_nat-zh-cn-16k-common-vocab8404-pytorch/example/asr_example.wav');
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-asr-check-'));
const server=createApplication({dataDir});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
try {
  const headers={'X-Requested-With':'MeetingLocal'};
  const settings=await fetch(base+'/api/settings',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({aiEnabled:false,baseUrl:'',model:'',transcriptionUrl:'http://127.0.0.1:10097/v1'})});assert.equal(settings.status,200);
  const up=await fetch(base+'/api/morning-meetings/upload?'+new URLSearchParams({title:'官方示例转写验证',meetingDate:'2026-09-28',fileName:'example.wav'}),{method:'POST',headers:{...headers,'Content-Type':'audio/wav'},body:fs.readFileSync(sample)});
  assert.equal(up.status,201);const {meeting}=await up.json();
  const result=await fetch(base+'/api/morning-meetings/'+meeting.id+'/analyze',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(300000)});
  const body=await result.json();assert.equal(result.status,200,JSON.stringify(body));
  assert.equal(body.meeting.status,'review');assert.ok(body.meeting.transcript.length>5);assert.ok(body.meeting.transcriptSegments.length>0);
  console.log(JSON.stringify({passed:true,text:body.meeting.transcript,segments:body.meeting.transcriptSegments.length,mode:body.analysisMode},null,2));
}finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dataDir,{recursive:true,force:true});}
