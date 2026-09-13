// Five-card daily stack and learning-delay regressions, using the real app code.
import assert from 'node:assert/strict';
import {getScriptSource} from './extract-script.mjs';
import {createDevice} from './device.mjs';
import {createFakeFirestore} from './fake-firestore.mjs';
const source = getScriptSource();
const DAY = 864e5;
function device(n=12) {
  return createDevice({source, firestore:createFakeFirestore(), deck:{
    themes:[{id:'work',label:'Work'}], books:[{id:'b',title:'Book',author:'Author',
      highlights:Array.from({length:n},(_,i)=>({id:`c${i}`,theme:'work',text:'test',loc:i,
        date:`2026-09-${String(i+1).padStart(2,'0')}`}))}]
  }});
}
function state(extra={}) {return {st:'rev',ef:2.5,ivl:10,reps:3,lapses:0,due:Date.now()-DAY,intro:Date.now()-30*DAY,...extra};}
const tests=[];const test=(name,fn)=>tests.push([name,fn]);
test('freshest five appear first, deterministically across reopen',()=>{
 const d=device();const expected=['c11','c10','c9','c8','c7'];
 assert.deepEqual([...d.run('buildQueue().cards.map(c=>c.id)')],expected);
 assert.deepEqual([...d.run('newSession("all").queue.map(c=>c.id)')],expected);
});
test('two fresh cards lead, with spare review slots filled by fresh cards',()=>{
 const d=device();d.run(`srs.c0=${JSON.stringify(state())};srs.c1=${JSON.stringify(state({due:Date.now()-2*DAY}))}`);
 assert.deepEqual([...d.run('buildQueue().cards.map(c=>c.id)')],['c11','c10','c1','c0','c9']);
});
test('large overdue backlog still reserves two newest cards',()=>{
 const d=device();d.run(`for(let i=0;i<8;i++)srs['c'+i]=${JSON.stringify(state())}`);
 assert.deepEqual([...d.run('buildQueue().cards.map(c=>c.id)')],['c11','c10','c0','c1','c2']);
 d.run('applyGrade("c11",3);session=newSession("all")');
 assert.deepEqual([...d.run('session.queue.map(c=>c.id)')],['c10','c0','c1','c2']);
 d.run('applyGrade("c10",0);session=newSession("all")');
 assert.deepEqual([...d.run('session.queue.map(c=>c.id)')],['c0','c1','c2']);
 assert.equal(d.run('session.pending.length'),1);
});
test('three reviews already done leave room for two fresh cards',()=>{
 const d=device();d.run(`for(let i=0;i<8;i++)srs['c'+i]=${JSON.stringify(state())}`);
 d.run('for(let i=0;i<3;i++)applyGrade("c"+i,3)');
 assert.deepEqual([...d.run('buildQueue().cards.map(c=>c.id)')],['c11','c10']);
});
test('only one unseen card fills the other four slots with reviews',()=>{
 const d=device();d.run(`for(let i=0;i<11;i++)srs['c'+i]=${JSON.stringify(state())}`);
 assert.deepEqual([...d.run('buildQueue().cards.map(c=>c.id)')],['c11','c0','c1','c10','c2']);
});
test('missing a week never produces more than five cards',()=>{
 const d=device(50);d.run(`srs=Object.fromEntries(cards.map(c=>[c.id,${JSON.stringify(state({due:Date.now()-7*DAY}))}]))`);
 assert.equal(d.run('buildQueue().cards.length'),5);assert.equal(d.run('buildQueue().backlog'),45);
});
test('five completed cards prevent a refill and leave other due dates unchanged',()=>{
 const d=device();d.run(`srs.c0=${JSON.stringify(state())}`);const due=d.run('srs.c0.due');
 d.run(`for(let i=1;i<=5;i++)srs['c'+i]=${JSON.stringify(state({due:Date.now()+DAY,__lastReviewAt:Date.now()}))}`);
 assert.equal(d.run('newSession("all").queue.length'),0);assert.equal(d.run('srs.c0.due'),due);
});
test('Again repeats the same card without admitting a sixth',()=>{
 const d=device();d.run('for(const c of buildQueue().cards)applyGrade(c.id,0)');
 assert.equal(d.run('dailyCardsUsed()'),5);assert.equal(d.run('buildQueue().cards.length'),0);
 assert.equal(d.run('buildQueue().pending.length'),5);
 d.run('srs.c11.due=Date.now()-1');
 assert.deepEqual([...d.run('buildQueue().cards.map(c=>c.id)')],['c11']);
});
test('pending learning cards survive rebuilding and return when due',()=>{
 const d=device();d.run('applyGrade("c11",0);session=newSession("all")');
 assert.equal(d.run('session.pending.length'),1);
 d.run('srs.c11.due=Date.now()-1;promotePending(session)');
 assert.equal(d.run('session.queue[0].id'),'c11');assert.equal(d.run('session.pending.length'),0);
});
test('pending learning counts as unfinished, not completed progress',()=>{
 const d=device();d.run('applyGrade("c11",0);session=newSession("all")');
 assert.equal(d.run('cardsLeft()'),5);assert.equal(d.run('progress(session).done'),0);
});
test('yesterday learning cards count toward today five-card limit',()=>{
 const d=device();d.run(`srs=Object.fromEntries(cards.map(c=>[c.id,${JSON.stringify(state({st:'lrn',step:1,ivl:0}))}]))`);
 assert.equal(d.run('buildQueue().cards.length'),5);
});
test('yesterday completed cards do not spend today budget',()=>{
 const d=device();d.run(`for(let i=0;i<5;i++)srs['c'+i]=${JSON.stringify(state({due:Date.now()+DAY,__lastReviewAt:Date.now()-DAY}))}`);
 assert.equal(d.run('buildQueue().cards.length'),5);assert.equal(d.run('dailyCardsUsed()'),0);
});
test('a deck refresh cannot refund a completed card absent from catalog',()=>{
 const d=device();d.run(`srs.removed=${JSON.stringify(state({__lastReviewAt:Date.now()}))}`);
 assert.equal(d.run('buildQueue().cards.length'),4);
});
test('missing or invalid highlight dates come after dated highlights',()=>{
 const d=device();d.run('cards.find(c=>c.id==="c11").date="invalid";cards.find(c=>c.id==="c10").date=null');
 assert.equal(d.run('buildQueue().cards[0].id'),'c9');
});
test('precise timestamps break ties within the same highlight day',()=>{
 const d=device();d.run('cards.find(c=>c.id==="c10").date="2026-09-12";cards.find(c=>c.id==="c10").highlightedAt="2026-09-12T18:00:00";cards.find(c=>c.id==="c11").highlightedAt="2026-09-12T12:00:00"');
 assert.equal(d.run('buildQueue().cards[0].id'),'c10');
});
test('the header has no category selector',()=>{
 const d=device();assert.ok(!d.run('headerHtml("5")').includes('data-theme'));
});
let failed=0;
for(const [name,fn] of tests){try{fn();console.log(`PASS  ${name}`)}catch(e){failed++;console.log(`FAIL  ${name}\n${e.stack}`)}}
console.log(`${tests.length-failed}/${tests.length} passed`);process.exitCode=failed?1:0;
