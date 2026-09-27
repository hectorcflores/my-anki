import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const start = html.indexOf('    function fuzzIvl(');
const end = html.indexOf('    function applyGrade(', start);
const source = html.slice(start, end);
const ctx = vm.createContext({});
vm.runInContext(`const MIN=60000,DAY=86400000,LEARN_STEPS=[MIN,10*MIN],RELEARN_STEPS=[10*MIN],GRAD_IVL=1,EASY_IVL=4,LAPSE_IVL=1,HARD_FACTOR=1.2,EASY_BONUS=1.3,MIN_EF=1.3,START_EF=2.5,LEECH_LAPSES=8; const freshState=()=>({st:'lrn',step:0,ef:2.5,ivl:0,due:0,reps:0,lapses:0}); ${source}; this.run=schedule;`, ctx);
const cardID = 'fe978e44aec68a75';
let seed = 0; for (const c of cardID) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
const cases=[];
const states=[null,...['lrn','rel','rev'].flatMap(st => [0,1].flatMap(step => [1,2,7,30,365].map(ivl => ({st,step,ivl,ef:2.5,due:0,reps:4,lapses:7,intro:1700000000000}))))];
for (const prev of states) for (let grade=0;grade<4;grade++) {
 const now=1780000000000;
 cases.push({cardID,prev,grade,now,expected:ctx.run(prev,grade,now,seed)});
}
writeFileSync(new URL('../app/test/fixtures/ios-scheduler.json',import.meta.url), JSON.stringify(cases,null,2));
console.log(`Exported ${cases.length} cases from the web scheduler`);
