// Source extraction only. Does not start CRM or read its environment/database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = path.resolve(root, '../04-CRM客户');
const ts = require(path.join(source, 'node_modules/typescript'));
const manifest = { source, extractedAt: new Date().toISOString(), files: [], fragments: [] };
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function write(relative, text) {
  const destination = path.join(root, relative);
  fs.mkdirSync(path.dirname(destination), {recursive:true});
  fs.writeFileSync(destination, text);
}
function copy(relative, destination = 'reference/crm/' + relative) {
  const file = path.join(source, relative);
  const content = fs.readFileSync(file);
  write(destination, content);
  manifest.files.push({source:relative, destination, sha256:hash(content)});
}
function tree(relative) {
  for (const entry of fs.readdirSync(path.join(source, relative), {withFileTypes:true})) {
    if (['node_modules', 'dist', '__pycache__', '.env'].includes(entry.name)) continue;
    const name = relative + '/' + entry.name;
    if (entry.isDirectory()) tree(name);
    else if (/\.(ts|js|json|py|md|txt|sql|css|svg)$/.test(entry.name)) copy(name);
  }
}
function fragment(file, destination, start, end) {
  const text=fs.readFileSync(path.join(source,file),'utf8');
  const content=text.slice(start,end);
  write(destination,content);
  manifest.fragments.push({source:file,destination,startLine:text.slice(0,start).split('\n').length,endLine:text.slice(0,end).split('\n').length,sha256:hash(content)});
}
function declarations(file, destination, predicate) {
  const text=fs.readFileSync(path.join(source,file),'utf8');
  const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
  const selected=ast.statements.filter(node=>predicate(node,text));
  if (!selected.length) throw Error('No declarations for '+destination);
  const chunks=selected.map(node=>text.slice(node.getFullStart(),node.end));
  write(destination,chunks.join('\n'));
  manifest.fragments.push({source:file,destination,sha256:hash(chunks.join('\n')),declarations:selected.map(node=>({name:node.name?.text || node.getText(ast).slice(0,100),startLine:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,endLine:ast.getLineAndCharacterOfPosition(node.end).line+1}))});
}
function names(node) {
  if(node.name) return node.name.text || '';
  if(ts.isVariableStatement(node)) return node.declarationList.declarations.map(d=>d.name.getText()).join(' ');
  return '';
}

// Untouched dependency sources are reference material, not a second running CRM.
for (const folder of ['frontend/src','backend/src','integration-sdk/src','services/funasr']) tree(folder);
for (const file of ['frontend/index.html','frontend/package.json','frontend/tsconfig.json','frontend/vite.config.ts','backend/package.json','backend/tsconfig.json','package.json','package-lock.json','LICENSE','NOTICE','AUTHORS.md','THIRD_PARTY_NOTICES.md','scripts/setup-funasr.ps1','scripts/start-funasr.ps1','docs/岗位工作台与数据清理-20260924.md']) {
  if(fs.existsSync(path.join(source,file))) copy(file);
}
const frontFile='frontend/src/prototype-api.ts';
const front=fs.readFileSync(path.join(source,frontFile),'utf8');
const start=front.indexOf('interface MorningMeetingMember');
const end=front.indexOf('async function completeLogin',start);
if(start<0||end<0) throw Error('Meeting section not found');
fragment(frontFile,'modules/meeting-agent/frontend.ts',start,end);
declarations(frontFile,'modules/meeting-agent/transcription-settings.ts',node=>/^(saveMorningMeetingTranscription|testMorningMeetingTranscription)$/.test(names(node)));
declarations(frontFile,'modules/workbench/frontend.ts',node=>/dashboard|todo|workbench|priorityTasks|topbarStats/i.test(names(node)));
const server='backend/src/server.ts';
declarations(server,'modules/meeting-agent/routes.ts',(node,text)=>/morningMeeting/i.test(names(node)) || (ts.isExpressionStatement(node) && /^app\.(get|post|patch|delete|use)\("\/api\/morning-meetings/.test(text.slice(node.getStart(),node.end))));
declarations(server,'modules/workbench/routes.ts',(node,text)=>ts.isExpressionStatement(node) && /^app\.(get|post|patch|delete)\("\/api\/(todos|dashboard)(?:\/|\")/.test(text.slice(node.getStart(),node.end)));
for(const [from,to] of [
  ['backend/src/morning-meeting-transcription.ts','modules/meeting-agent/transcription.ts'],
  ['backend/src/workbench-overview.ts','modules/workbench/overview.ts'],
  ['backend/src/workbench-role-test.ts','modules/workbench/overview.test.ts'],
  ['frontend/src/todo-navigation.ts','modules/workbench/todo-navigation.ts'],
  ['frontend/src/todo-navigation-test.ts','modules/workbench/todo-navigation.test.ts']
]) copy(from,to);
const htmlFile='frontend/index.html';
const html=fs.readFileSync(path.join(source,htmlFile),'utf8');
for(const [id,folder] of [['dashboard','workbench'],['morning-meetings','meeting-agent']]) {
  const pattern=new RegExp('<div\\s+class="view[^\"]*"\\s+id="'+id+'"[^>]*>');
  const match=pattern.exec(html);if(!match)throw Error('View not found '+id);
  const tags=/<\/?div\b[^>]*>/g;tags.lastIndex=match.index;
  let depth=0, token, finish;
  while((token=tags.exec(html))) {depth+=token[0].startsWith('</')?-1:1;if(!depth){finish=tags.lastIndex;break;}}
  if(!finish)throw Error('Unclosed view '+id);
  fragment(htmlFile,'modules/'+folder+'/view.html',match.index,finish);
}
// Keep original cascade order; shared CRM CSS is necessary to preserve its appearance.
const styles=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]);
write('shared/crm-styles.css', styles.join('\n'));
manifest.fragments.push({source:htmlFile,destination:'shared/crm-styles.css',sha256:hash(styles.join('\n')),note:'All original inline style blocks in cascade order; later trimming requires visual comparison.'});
write('extraction-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({copiedFiles:manifest.files.length,extractedModules:manifest.fragments.length,target:root}));
