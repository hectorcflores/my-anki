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
test('freshest unseen cards lead the next batch',()=>{
 const d=device();assert.deepEqual([...d.run('buildQueue().cards.map(c=>c.id)')],['c11','c10','c9','c8','c7']);
});
test('backlog still leaves two fresh slots',()=>{
 const d=device();d.run(`for(let i=0;i<8;i++)srs['c'+i]=${JSON.stringify(state())}`);
 assert.deepEqual([...d.run('buildQueue().cards.map(c=>c.id)')],['c11','c10','c0','c1','c2']);
});
test('five answers trigger a two-second milestone with next-five copy',()=>{
 const d=device();d.run('for(let i=0;i<5;i++)recordAnswer();render()');
 assert.equal(d.run('answersToday()'),5);
 assert.ok(d.run('milestoneUntil-Date.now()')>1500);
 assert.ok(d.run('app.innerHTML').includes('5 reviewed today'));
 assert.ok(d.run('app.innerHTML').includes('Your next five are ready.'));
 d.run('milestoneUntil=Date.now()-1;render()');
 assert.ok(!d.run('app.innerHTML').includes('milestone-stack'));
});
test('finishing five automatically admits more cards',()=>{
 const d=device();d.run('for(const c of [...session.queue]){applyGrade(c.id,3);recordAnswer()} session.queue=[];milestoneUntil=0;render()');
 assert.equal(d.run('session.queue.length'),5);
 assert.ok(d.run('session.queue.every(c=>!srs[c.id])'));
});
test('Again respects its delay while unseen cards continue',()=>{
 const d=device();d.run('applyGrade("c11",0);session=newSession("all")');
 assert.ok(!d.run('session.queue.some(c=>c.id==="c11")'));
 assert.ok(d.run('session.pending.some(c=>c.id==="c11")'));
 d.run('srs.c11.due=Date.now()-1;promotePending(session)');
 assert.equal(d.run('session.queue[0].id'),'c11');
});
test('only pending cards shows no waiting message',()=>{
 const d=device(1);d.run('applyGrade("c0",0);session=newSession("all");render()');
 assert.ok(d.run('app.innerHTML').includes('All caught up'));
 assert.ok(!d.run('app.innerHTML').includes('due back shortly'));
});
test('answer count resets on a new day and every fifth answer pauses',()=>{
 const d=device();d.run('localStorage.setItem("my-anki.answers.v1",JSON.stringify({day:"2000-01-01",count:99}))');
 assert.equal(d.run('answersToday()'),0);
 d.run('for(let i=0;i<10;i++)recordAnswer()');assert.equal(d.run('answersToday()'),10);
 assert.ok(d.run('milestoneUntil>Date.now()'));
});
test('precise highlight timestamps determine freshness',()=>{
 const d=device();d.run('cards.find(c=>c.id==="c10").highlightedAt="2026-09-12T18:00:00";cards.find(c=>c.id==="c11").highlightedAt="2026-09-12T12:00:00"');
 assert.equal(d.run('buildQueue().cards[0].id'),'c10');
});
test('footer uses the newest card timestamp instead of stale build metadata',()=>{
 const d=createDevice({source,firestore:createFakeFirestore(),deck:{
  generated:'2026-09-26',latest:{date:'2026-09-16',title:'Old Book'},themes:[{id:'work',label:'Work'}],
  books:[{id:'new',title:'New Book',author:'Author',highlights:[{id:'new-card',theme:'work',text:'test',loc:1,highlightedAt:'2026-09-20T18:00:00Z'}]}]
 }});
 assert.ok(d.run('footDeck()').includes('newest highlight 20 Sep, New Book'));
 assert.ok(d.run('footDeck(cards[0])').includes('highlighted 20 Sep'),
  'a visible card shows its own original highlight date');
 assert.ok(!d.run('footDeck(cards[0])').includes('newest highlight'),
  'the visible-card footer cannot be mistaken for the library-wide newest date');
});
let failed=0;
for(const [name,fn] of tests){try{fn();console.log(`PASS  ${name}`)}catch(e){failed++;console.log(`FAIL  ${name}\n${e.stack}`)}}
console.log(`${tests.length-failed}/${tests.length} passed`);process.exitCode=failed?1:0;
