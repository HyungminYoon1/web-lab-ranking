import test from 'node:test';
import assert from 'node:assert/strict';
import { definition, POLICY, MAX_BODY, nickname, verified } from '../src/domain.js';
import { RankingRepository } from '../src/repository.js';
import { RankingService } from '../src/service.js';
import { route } from '../src/controller.js';
import { storage } from './sqlite-adapter.js';
import { neonActions, parcelActions } from './fixtures.js';

function harness(){const db=storage(),repository=new RankingRepository(db);let now=Date.UTC(2026,9,13);return{db,repository,service:new RankingService(repository,{clock:()=>now}),get now(){return now;},advance:n=>{now+=n;}};}
async function identity(h){const p=await h.service.createIdentity({});return{...p,auth:'Bearer '+p.token};}
const startBody=(p,game='neon-tactics')=>{const d=definition(game);return{playerId:p.playerId,game,rulesVersion:d.rulesVersion,challengeId:d.challengeId};};
async function attempt(h,p,game='neon-tactics'){const b=startBody(p,game),r=await h.service.start(b,p.auth);return{...b,runId:r.runId,nickname:'',actions:game==='neon-tactics'?neonActions:parcelActions};}
const rejected=(fn,code)=>assert.rejects(fn,e=>e.code===code);

test('edge authentication delay cannot submit after the actual ticket expiry',async()=>{
  const h=harness();try{const p=await identity(h),b=await attempt(h,p);h.advance(POLICY.ticketMs-1);
    const auth=h.service.authenticate.bind(h.service);h.service.authenticate=async(...args)=>{const result=await auth(...args);h.advance(1);return result;};
    await rejected(()=>h.service.submit(b,p.auth),'attempt_expired');assert.equal(h.repository.count('bests'),0);
  }finally{h.db.close();}
});

test('edge ticket lifetime starts when authentication completes, not before awaiting it',async()=>{
  const h=harness();try{const p=await identity(h),auth=h.service.authenticate.bind(h.service);
    h.service.authenticate=async(...args)=>{const result=await auth(...args);h.advance(3000);return result;};
    const run=await h.service.start(startBody(p),p.auth);assert.equal(Date.parse(run.expiresAt),h.now+POLICY.ticketMs);
    assert.equal(h.repository.player(p.playerId).touched_at,h.now);
  }finally{h.db.close();}
});

test('edge game identifiers reject coercible objects and arrays',()=>{
  for(const game of [['neon-tactics'],{toString:()=> 'neon-tactics'},null,0,true])assert.throws(()=>definition(game),e=>e.code==='unknown_game');
});

test('edge parallel same-ticket submissions remain one result and one best',async()=>{
  const h=harness();try{const p=await identity(h),b=await attempt(h,p);const results=await Promise.all(Array.from({length:8},()=>h.service.submit(b,p.auth)));
    for(const result of results)assert.deepEqual(result,results[0]);assert.equal(h.repository.count('bests'),1);
    const changed=await h.service.submit({...b,nickname:'changed',actions:[]},p.auth);assert.deepEqual(changed,results[0]);assert.equal(h.service.board(b.game).entries[0].nickname.startsWith('익명-'),true);
  }finally{h.db.close();}
});

test('edge deletion during authenticated submission leaves no orphan best',async()=>{
  const h=harness();try{const p=await identity(h),b=await attempt(h,p),auth=h.service.authenticate.bind(h.service);
    h.service.authenticate=async(...args)=>{const result=await auth(...args);h.repository.deletePlayer(p.playerId);return result;};
    await rejected(()=>h.service.submit(b,p.auth),'unknown_attempt');for(const table of ['players','tickets','bests'])assert.equal(h.repository.count(table),0);
  }finally{h.db.close();}
});

test('edge open-ticket cap is scoped to identity and game and preserves completed retries',async()=>{
  const h=harness();try{const p=await identity(h),q=await identity(h),done=await attempt(h,p);await h.service.submit(done,p.auth);
    const other=await attempt(h,q),parcel=await attempt(h,p,'parcel-panic'),runs=[];
    for(let i=0;i<5;i++){h.advance(1);runs.push(await attempt(h,p));}
    assert.equal(h.repository.rows('SELECT id FROM tickets WHERE player_id=? AND game=? AND result IS NULL',p.playerId,'neon-tactics').length,3);
    assert.equal(h.repository.ticket(runs[0].runId),undefined);assert.ok(h.repository.ticket(runs.at(-1).runId));assert.ok(h.repository.ticket(done.runId));assert.ok(h.repository.ticket(other.runId));assert.ok(h.repository.ticket(parcel.runId));
  }finally{h.db.close();}
});

test('edge identity and request daily bounds allow last slot, reject next, reset next UTC day',async()=>{
  const h=harness();try{const day=Math.floor(h.now/86400000);h.repository.quota(h.now);h.repository.sql.exec('UPDATE daily SET identities=? WHERE day=?',POLICY.identitiesPerDay-1,day);
    await identity(h);await rejected(()=>identity(h),'daily_limit');assert.equal(h.repository.count('players'),1);
    h.repository.sql.exec('UPDATE daily SET requests=? WHERE day=?',POLICY.requestsPerDay-1,day);assert.equal(h.service.board('neon-tactics').entries.length,0);assert.throws(()=>h.service.board('neon-tactics'),e=>e.code==='daily_limit');
    h.advance(86400000);await identity(h);assert.equal(h.repository.count('players'),2);
  }finally{h.db.close();}
});

test('edge full identity capacity fails closed without evicting an existing identity',async()=>{
  const h=harness();try{const p=await identity(h);h.repository.transaction(()=>{for(let i=1;i<POLICY.identities;i++)h.repository.sql.exec('INSERT INTO players VALUES(?,?,?,?)','fixture-'+i,'fixture-hash',h.now,h.now);});
    await rejected(()=>identity(h),'storage_limit');assert.equal(h.repository.count('players'),POLICY.identities);assert.ok(h.repository.player(p.playerId));
  }finally{h.db.close();}
});

test('edge full ticket and best capacities reject additions but retain previous results',async()=>{
  const h=harness();try{
    const p=await identity(h),q=await identity(h),won=await attempt(h,p);await h.service.submit(won,p.auth);
    const waiting=await attempt(h,q),retry=await attempt(h,p),d=definition('neon-tactics');
    h.repository.transaction(()=>{
      for(let i=h.repository.count('bests');i<POLICY.bests;i++)h.repository.sql.exec('INSERT INTO bests VALUES(?,?,?,?,?,?,?,?,?,?,?,?)','fixture-'+i,d.game,d.rulesVersion,d.challengeId,'A',1,0,0,0,0,h.now,'[]');
      for(let i=h.repository.count('tickets');i<POLICY.tickets;i++)h.repository.sql.exec('INSERT INTO tickets VALUES(?,?,?,?,?,?,?)','capacity-'+i,p.playerId,d.game,d.rulesVersion,d.challengeId,h.now+POLICY.ticketMs,null);
    });
    await rejected(()=>attempt(h,q),'storage_limit');assert.equal(h.repository.count('tickets'),POLICY.tickets);
    await rejected(()=>h.service.submit(waiting,q.auth),'storage_limit');assert.equal(h.repository.ticket(waiting.runId).result,null);
    assert.equal((await h.service.submit(retry,p.auth)).improved,false);assert.equal(h.repository.count('bests'),POLICY.bests);
    assert.equal(h.repository.first('SELECT score FROM bests WHERE player_id=?',p.playerId).score,4280);
  }finally{h.db.close();}
});

test('edge board top-50, tied ranks, wrong versions and private projection use actual SQLite',()=>{
  const h=harness();try{const d=definition('neon-tactics');for(let i=0;i<55;i++){
      const player='fixture-'+String(i).padStart(2,'0');h.repository.sql.exec('INSERT INTO players VALUES(?,?,?,?)',player,'fixture-hash',h.now,h.now);
      h.repository.sql.exec('INSERT INTO bests VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',player,d.game,d.rulesVersion,d.challengeId,'A',i<2?5000:5000-i,0,0,0,0,h.now,'[]');
    }
    const rows=h.repository.board(d,h.now);assert.equal(rows.length,50);assert.deepEqual(rows.slice(0,3).map(x=>x.rank),[1,1,3]);assert.ok(rows.every(r=>!('player_id'in r)&&!('actions'in r)));
    assert.equal(h.repository.board({...d,rulesVersion:'different'},h.now).length,0);
  }finally{h.db.close();}
});

test('edge retention visibility and board-cache TTL hold at exact documented boundaries',async()=>{
  const h=harness();try{const p=await identity(h),b=await attempt(h,p);await h.service.submit(b,p.auth);
    assert.equal(h.service.board(b.game).entries.length,1);h.repository.sql.exec('UPDATE bests SET nickname=?','updated');h.advance(29999);assert.notEqual(h.service.board(b.game).entries[0].nickname,'updated');h.advance(1);assert.equal(h.service.board(b.game).entries[0].nickname,'updated');
    h.advance(POLICY.retentionMs-30000);assert.equal(h.repository.board(definition(b.game),h.now).length,1);h.advance(1);assert.equal(h.repository.board(definition(b.game),h.now).length,0);
  }finally{h.db.close();}
});

test('edge bounded cleanup removes only its batch and never live records',async()=>{
  const h=harness();try{const p=await identity(h);for(let i=0;i<30;i++)h.repository.sql.exec('INSERT INTO players VALUES(?,?,?,?)','expired-'+i,'fixture',0,0);
    for(let i=0;i<105;i++)h.repository.sql.exec('INSERT INTO tickets VALUES(?,?,?,?,?,?,?)','expired-ticket-'+i,p.playerId,'neon-tactics','x','x',h.now-1,null);
    h.repository.cleanup(h.now);assert.equal(h.repository.count('players'),6);assert.equal(h.repository.count('tickets'),5);assert.ok(h.repository.player(p.playerId));
    h.repository.cleanup(h.now);assert.equal(h.repository.count('players'),1);assert.equal(h.repository.count('tickets'),0);
  }finally{h.db.close();}
});

test('edge wire byte limit, invalid UTF-8, missing body and strict JSON value shapes',async()=>{
  const h=harness();try{const url='https://ranking.test/v1/identities';const send=body=>route(new Request(url,{method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body}),h.service);
    assert.equal((await send('{}'+' '.repeat(MAX_BODY-2))).status,201);
    assert.equal((await send('{}'+' '.repeat(MAX_BODY-1))).status,413);
    assert.equal((await send('"'+'가'.repeat(16384)+'"')).status,413);
    assert.equal((await send(new Uint8Array([0xff]))).status,400);
    for(const body of [undefined,'null','[]','false','{"extra":1}'])assert.equal((await send(body)).status,400);
    assert.equal(h.repository.count('players'),1);
  }finally{h.db.close();}
});

test('edge stream limit is counted across chunks and cancels the unread body',async()=>{
  let cancelled=false,read=0;const h=harness();try{const stream=new ReadableStream({pull(c){read++;c.enqueue(new Uint8Array(MAX_BODY/2+1).fill(32));},cancel(){cancelled=true;}});
    const response=await route(new Request('https://ranking.test/v1/identities',{method:'POST',headers:{'Content-Type':'application/json'},body:stream,duplex:'half'}),h.service);
    assert.equal(response.status,413);assert.equal(cancelled,true);assert.ok(read<=3);assert.equal(h.repository.count('players'),0);
  }finally{h.db.close();}
});

test('edge header rejection cancels the unread request stream before responding',async()=>{
  for(const [headers,status]of[[{'Content-Type':'text/plain'},415],[{'Content-Type':'application/json','Content-Length':String(MAX_BODY+1)},413]]){
    let cancelled=false;const stream=new ReadableStream({pull(c){c.enqueue(new Uint8Array([32]));},cancel(){cancelled=true;}});
    const response=await route(new Request('https://ranking.test/v1/identities',{method:'POST',headers,body:stream,duplex:'half'}),{});
    assert.equal(response.status,status);assert.equal(cancelled,true,'unread rejected body is released');
  }
});

test('edge replay nonfinite/type/trailing actions reject without mutation',()=>{
  const before=JSON.stringify(neonActions);for(const actions of [[null],[{}],[{type:'move',unit:NaN,x:0,y:0}], [...neonActions,{type:'endTurn'}]])assert.throws(()=>verified('neon-tactics',actions));
  assert.equal(JSON.stringify(neonActions),before);assert.equal(verified('neon-tactics',neonActions).score,4280);
  assert.equal(nickname('가'.repeat(16)),'가'.repeat(16));assert.throws(()=>nickname('가'.repeat(17)));
  assert.equal(nickname('e\u0301'),'é');assert.throws(()=>nickname('a\u0000b'));
});
