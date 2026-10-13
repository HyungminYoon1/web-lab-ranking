import assert from 'node:assert/strict';
import { neonActions, parcelActions } from '../test/fixtures.js';

// Local workerd ONLY. Never send synthetic identity/score writes to production.
const base=process.argv[2]??'http://127.0.0.1:59610';
const url=new URL(base);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw new Error('Loopback required');
const origin='https://hyungminyoon1.github.io',checks=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name);};
async function request(path,{method='GET',body,token,requestOrigin=origin,headers={}}={}){
  const response=await fetch(base+path,{method,headers:{...(requestOrigin?{Origin:requestOrigin}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const text=await response.text();const data=text?JSON.parse(text):null;return{response,data};
}
const health=await request('/health');check('health and two approved boards',health.response.status===200&&health.data.games.length===2);
check('exact CORS and no-store headers',health.response.headers.get('Access-Control-Allow-Origin')===origin&&health.response.headers.get('Cache-Control')==='no-store');
check('foreign origin denied',(await request('/health',{requestOrigin:'https://untrusted.example'})).response.status===403);
check('originless public health readable',(await request('/health',{requestOrigin:null})).response.status===200);
check('originless write denied',(await request('/v1/identities',{method:'POST',body:{},requestOrigin:null})).response.status===403);
check('allowed preflight',(await request('/v1/scores',{method:'OPTIONS'})).response.status===204);
check('originless preflight denied',(await request('/v1/scores',{method:'OPTIONS',requestOrigin:null})).response.status===403);
check('unsupported HTTP method',(await request('/health',{method:'PUT'})).response.status===405);
check('unknown route',(await request('/not-found')).response.status===404);
check('malformed shape',(await request('/v1/identities',{method:'POST',body:{extra:true}})).response.status===400);
check('oversize wire data',(await request('/v1/identities',{method:'POST',body:{value:'가'.repeat(20000)}})).response.status===413);
const players=[];
try{
  for(let i=0;i<2;i++){const created=await request('/v1/identities',{method:'POST',body:{}});check('synthetic local identity '+i,created.response.status===201);players.push(created.data);}
  for(const d of health.data.games){
    const p=players[0],body={playerId:p.playerId,game:d.game,rulesVersion:d.rulesVersion,challengeId:d.challengeId};
    const start=await request('/v1/runs',{method:'POST',body,token:p.token});check('bound ticket '+d.game,start.response.status===201);
    const submission={...body,runId:start.data.runId,nickname:'Local fixture',actions:d.game==='neon-tactics'?neonActions:parcelActions};
    check('foreign player denied '+d.game,(await request('/v1/scores',{method:'POST',body:submission,token:players[1].token})).response.status===401);
    check('client score field denied '+d.game,(await request('/v1/scores',{method:'POST',body:{...submission,score:99999},token:p.token})).response.status===400);
    check('incomplete replay denied '+d.game,(await request('/v1/scores',{method:'POST',body:{...submission,actions:[]},token:p.token})).response.status===422);
    const results=await Promise.all(Array.from({length:3},()=>request('/v1/scores',{method:'POST',body:submission,token:p.token})));
    const expected=d.game==='neon-tactics'?4280:1457;check('legal server replay '+d.game,results.every(r=>r.response.status===201&&r.data.score===expected));
    check('idempotent concurrent retry '+d.game,results.every(r=>JSON.stringify(r.data)===JSON.stringify(results[0].data)));
    const board=await request('/v1/boards/'+d.game);check('query contains verified local result '+d.game,board.data.entries.some(r=>r.nickname==='Local fixture'&&r.score===expected));
    check('board excludes private properties '+d.game,board.data.entries.every(r=>!('playerId'in r)&&!('actions'in r)&&!('token'in r)));
  }
  const p=players[0];check('another identity cannot delete owner',(await request('/v1/identity',{method:'DELETE',body:{playerId:p.playerId},token:players[1].token})).response.status===401);
}finally{
  for(const p of players){const removed=await request('/v1/identity',{method:'DELETE',body:{playerId:p.playerId},token:p.token});assert.equal(removed.response.status,200,'local fixture cleanup');}
}
for(const d of health.data.games)check('synthetic result removed '+d.game,!(await request('/v1/boards/'+d.game)).data.entries.some(r=>r.nickname==='Local fixture'));
console.log(JSON.stringify({environment:'LOCAL_WORKERD',pass:checks.length,checks,productionWrites:0},null,2));
