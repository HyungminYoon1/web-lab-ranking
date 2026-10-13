import test from 'node:test';
import assert from 'node:assert/strict';
import { mountRanking } from '../client/ranking-client.js';

// Explicit DOM/network/storage doubles: these exercise the real client callbacks,
// not physical browser storage policy or human game completion.
class Element extends EventTarget {
  constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.textContent='';this.value='';this.disabled=false;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  setAttribute(){}
  click(){if(!this.disabled)this.dispatchEvent(new Event('click'));}
}
const KEY='web-lab-ranking-identity-v1';
const identity={version:1,playerId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',token:'a'.repeat(64)};
const definition={game:'neon-tactics',rulesVersion:'fixture-v1',challengeId:'fixture-16',title:'fixture'};
const run={runId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',definition,expiresAt:'2026-10-14T00:00:00.000Z'};
const response=data=>({ok:true,status:200,json:async()=>data});
const all=node=>[node,...node.children.flatMap(child=>typeof child==='object'?all(child):[])];
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function setup(t,{stored=identity,dropWrites=false}={}){
  const originals=new Map(['document','localStorage','fetch','confirm','addEventListener'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const events=new EventTarget(),root=new Element('div'),map=new Map([['private-game','preserve']]);if(stored)map.set(KEY,JSON.stringify(stored));
  const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>{if(!dropWrites)map.set(k,v);},removeItem:k=>map.delete(k)};
  const values={document:{createElement:tag=>new Element(tag)},localStorage:storage,confirm:()=>true,addEventListener:events.addEventListener.bind(events),fetch:async()=>{throw new Error('unconfigured fixture');}};
  for(const[k,value]of Object.entries(values))Object.defineProperty(globalThis,k,{configurable:true,writable:true,value});
  t.after(()=>{for(const[k,d]of originals)if(d)Object.defineProperty(globalThis,k,d);else delete globalThis[k];});
  let starts=0;const adapter={getDefinition:()=>definition,start:()=>{starts++;},isComplete:()=>true,getActions:()=>[]};
  const client=mountRanking({root,adapter,apiBase:'https://web-lab-ranking.hyeongmin92.workers.dev'});
  return{root,map,storage,client,get starts(){return starts;},button:text=>all(root).find(n=>n.tagName==='BUTTON'&&n.textContent===text),status:()=>all(root).find(n=>n.className==='ranking-status').textContent,event:key=>{const e=new Event('storage');e.key=key;events.dispatchEvent(e);}};
}

test('edge ranking client detects silent identity write failure before claiming durable access',async t=>{
  const h=setup(t,{stored:null,dropWrites:true});globalThis.fetch=async url=>response(url.endsWith('/identities')?identity:run);
  h.button('공개 기록 도전').click();await settle();assert.equal(h.starts,1);assert.match(h.status(),/현재 탭/);assert.equal(h.map.has(KEY),false);assert.equal(h.map.get('private-game'),'preserve');
});

test('edge storage.clear event removes stale ranking identity and ticket',async t=>{
  const h=setup(t);globalThis.fetch=async()=>response(run);h.button('공개 기록 도전').click();await settle();assert.equal(h.button('완료 기록 등록').disabled,false);
  h.map.delete(KEY);h.event(null);assert.equal(h.button('완료 기록 등록').disabled,true);assert.equal(h.button('공개 기록 삭제').disabled,true);
});

test('edge identity deletion while ticket request awaits cannot activate a stale public challenge',async t=>{
  const h=setup(t);let release;globalThis.fetch=()=>new Promise(resolve=>{release=()=>resolve(response(run));});
  h.button('공개 기록 도전').click();await settle();h.map.delete(KEY);h.event(KEY);release();await settle();
  assert.equal(h.starts,0);assert.equal(h.button('완료 기록 등록').disabled,true);
});

test('edge delayed deletion must not erase a newer identity from another tab',async t=>{
  const h=setup(t);let release;globalThis.fetch=()=>new Promise(resolve=>{release=()=>resolve(response({deleted:true}));});
  h.button('공개 기록 삭제').click();await settle();const newer={...identity,playerId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};h.map.set(KEY,JSON.stringify(newer));h.event(KEY);release();await settle();
  assert.equal(h.map.get(KEY)===JSON.stringify(newer),true);assert.equal(h.button('공개 기록 삭제').disabled,false);assert.equal(h.map.get('private-game'),'preserve');
});

test('edge invalid response preserves the last successfully displayed board',async t=>{
  const h=setup(t);globalThis.fetch=async()=>response({definition,entries:[{rank:1,nickname:'valid',score:5}]});h.button('순위 보기').click();await settle();
  const board=all(h.root).find(n=>n.className==='ranking-board'),prior=board.children[0];assert.ok(prior);
  globalThis.fetch=async()=>response({definition,entries:[{rank:-1,nickname:'invalid',score:5}]});h.button('순위 보기').click();await settle();
  assert.equal(board.children[0],prior);assert.match(h.status(),/연결할 수 없습니다/);
});

test('edge repeated in-flight clicks issue one request and recover controls after failure',async t=>{
  const h=setup(t);let release,calls=0;globalThis.fetch=()=>{calls++;return new Promise(resolve=>{release=()=>resolve({ok:false,status:503,json:async()=>({error:'service_unavailable'})});});};
  h.button('순위 보기').click();h.button('순위 보기').click();h.button('공개 기록 도전').click();assert.equal(calls,1);assert.equal(h.button('순위 보기').disabled,true);release();await settle();
  assert.equal(h.button('순위 보기').disabled,false);assert.equal(h.starts,0);assert.match(h.status(),/개인 플레이/);
});

test('edge cancelled opt-in or deletion never invokes transport or resets private play',async t=>{
  const h=setup(t);let calls=0;globalThis.confirm=()=>false;globalThis.fetch=async()=>{calls++;return response(run);};
  h.button('공개 기록 도전').click();await settle();h.button('공개 기록 삭제').click();await settle();assert.equal(calls,0);assert.equal(h.starts,0);assert.equal(h.map.get('private-game'),'preserve');assert.equal(h.map.has(KEY),true);
});

test('edge malformed JSON, network type errors and invalid board versions fail without game changes',async t=>{
  const h=setup(t);for(const fetcher of [async()=>{throw new TypeError('network');},async()=>({ok:true,status:200,json:async()=>{throw Error('bad JSON');}}),async()=>response({definition:{...definition,rulesVersion:'different'},entries:[]})]){
    globalThis.fetch=fetcher;h.button('순위 보기').click();await settle();assert.equal(h.starts,0);assert.equal(h.button('순위 보기').disabled,false);assert.ok(h.status());assert.equal(h.map.get('private-game'),'preserve');
  }
});

test('edge invalid ticket identifiers cannot reset the current game',async t=>{
  const h=setup(t);for(const runId of ['', 'not-a-ticket', {}, 1]){
    globalThis.fetch=async()=>response({...run,runId});h.button('공개 기록 도전').click();await settle();assert.equal(h.starts,0);assert.equal(h.button('완료 기록 등록').disabled,true);
  }
});

test('edge unconfirmed delete response retains the credential',async t=>{
  const h=setup(t);globalThis.fetch=async()=>response({deleted:false});const prior=h.map.get(KEY);
  h.button('공개 기록 삭제').click();await settle();assert.equal(h.map.get(KEY)===prior,true);assert.equal(h.button('공개 기록 삭제').disabled,false);assert.doesNotMatch(h.status(),/삭제되었습니다/);
});

test('edge request timeout aborts and recovers controls without resetting private play',async t=>{
  const h=setup(t);t.mock.timers.enable({apis:['setTimeout']});let aborted=false;
  globalThis.fetch=(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('fixture timeout','AbortError'));}));
  h.button('순위 보기').click();assert.equal(h.button('순위 보기').disabled,true);t.mock.timers.tick(12000);await settle();
  assert.equal(aborted,true);assert.equal(h.button('순위 보기').disabled,false);assert.equal(h.starts,0);assert.match(h.status(),/개인 플레이/);assert.equal(h.map.get('private-game'),'preserve');
});
