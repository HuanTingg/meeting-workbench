import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync(new URL('../app/analytics.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const context=vm.createContext({Intl,Date});vm.runInContext(code,context);
const calculate=(tasks,start='2026-09-01',end='2026-09-30')=>context.analyticsData(tasks,start,end,Date.parse('2026-09-30T12:00:00+08:00'));
test('analytics respects Shanghai dates, inclusive end, final completion and distinct cohorts',()=>{
  const rows=[
    {id:'a',createdAt:'2026-08-31T16:00:00Z',done:true,completedAt:'2026-09-30T15:59:59Z',dueAt:'2026-09-30'},
    {id:'b',createdAt:'2026-09-30T16:00:00Z',done:false,dueAt:'2026-10-02'},
    {id:'c',createdAt:'2026-08-01T00:00:00Z',done:true,completedAt:'2026-09-01T00:00:00Z',dueAt:''},
    {id:'d',createdAt:'2026-09-10T00:00:00Z',done:false,completedAt:null,completions:[{done:true,at:'2026-09-11T00:00:00Z'}],dueAt:'2026-09-29'},
    {id:'e',done:true,dueAt:''}
  ];
  const d=calculate(rows);
  assert.deepEqual(Array.from(d.created,t=>t.id),['a','d']);
  assert.deepEqual(Array.from(d.completed,t=>t.id),['a','c']);
  assert.equal(d.days.length,30);assert.equal(d.onTime.length,1);assert.equal(d.dated.length,1);
  assert.deepEqual(Array.from(d.states,g=>g.length),[0,1,1]);
});
test('analytics due times, missing dates, empty periods and zero denominators',()=>{
  const d=calculate([
    {id:'a',createdAt:'2026-09-01',done:true,completedAt:'2026-09-02T04:00:01Z',dueAt:'2026-09-02 12:00'},
    {id:'b',createdAt:'2026-09-01',done:false,dueAt:'2026-09-30'},
    {id:'c',createdAt:'bad',done:true,completedAt:'bad',dueAt:'bad'},
  ]);
  assert.equal(d.onTime.length,0);assert.equal(d.dated.length,1);assert.equal(d.states[0].length,1);
  const empty=calculate([],'2026-09-30','2026-09-30');assert.equal(empty.days.length,1);assert.equal(empty.dated.length,0);assert.equal(empty.created.length,0);
});
