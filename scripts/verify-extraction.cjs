const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'extraction-manifest.json'),'utf8'));
let checked=0;
for(const item of [...manifest.files,...manifest.fragments]) {
  const bytes=fs.readFileSync(path.join(root,item.destination));
  const actual=crypto.createHash('sha256').update(bytes).digest('hex');
  if(actual!==item.sha256)throw Error('Extraction changed: '+item.destination);
  checked++;
}
console.log(`Verified ${checked} extracted files and fragments.`);
